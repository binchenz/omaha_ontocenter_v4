import { Logger } from '@nestjs/common';
import type { LlmClient, LlmMessage, LlmOptions, LlmResponse, ToolDefinition } from './llm-client.interface';

/**
 * A self-inflicted deadline: OUR per-call timer fired, not an upstream network
 * timeout. Tagged so `isRetryable` can refuse it — re-firing a slow-but-alive
 * call just abandons an in-flight request and starts another (Layer A: the 3×
 * concurrent-cost leak that drained the DeepSeek balance). A genuine socket-level
 * ETIMEDOUT (server never responded) is a plain Error and stays retryable.
 */
export class LlmTimeoutError extends Error {
  readonly isDeadline = true;
  constructor(public readonly timeoutMs: number) {
    super(`LLM call timeout after ${timeoutMs}ms`);
    this.name = 'LlmTimeoutError';
  }
}

/** Classify whether an error is worth retrying (transient) or fatal (4xx / our own deadline). */
export function isRetryable(error: unknown): boolean {
  // Our own deadline is never retryable — the call was alive, we just gave up on it.
  if (error instanceof LlmTimeoutError) return false;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Network errors — always transient
    if (msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('timeout')) return true;
    // HTTP status from error properties
    const status = (error as any).status ?? (error as any).statusCode;
    if (typeof status === 'number') {
      return status >= 500 || status < 400;
    }
  }
  // Default: assume retryable (safe default for unknown errors)
  return true;
}

/** Slow reasoning path (thinking-mode / deepseek-v4-pro high-effort): a healthy
 *  chain-of-thought decode legitimately runs to ~2min. */
const THINKING_TIMEOUT_MS = 120_000;
/** Fast path (json-mode classify, flash lookups): should fail fast if it stalls. */
const NON_THINKING_TIMEOUT_MS = 45_000;

export interface ResilientLlmOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  /** Optional callback invoked after each LLM call — used by HealthModule to track reachability. */
  onSuccess?: () => void;
  onFailure?: (error: string) => void;
}

export class ResilientLlmClient implements LlmClient {
  private readonly logger = new Logger(ResilientLlmClient.name);
  /** Explicit ceiling from ctor/env. When set it wins over per-call derivation
   *  (preserves existing wiring + tests that pass a small timeoutMs). Undefined
   *  → the timeout is derived per call from the request options. */
  private readonly explicitTimeoutMs?: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly onSuccess?: () => void;
  private readonly onFailure?: (error: string) => void;

  constructor(
    private readonly inner: LlmClient,
    options?: ResilientLlmOptions,
  ) {
    // Precedence: ctor option → LLM_TIMEOUT_MS env → (undefined ⇒ per-call derivation).
    // A configured value is treated as a hard override so an operator can still pin it.
    this.explicitTimeoutMs = options?.timeoutMs ?? (process.env.LLM_TIMEOUT_MS ? Number(process.env.LLM_TIMEOUT_MS) : undefined);
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryBaseDelayMs = options?.retryBaseDelayMs ?? 200;
    this.onSuccess = options?.onSuccess;
    this.onFailure = options?.onFailure;
  }

  /** Resolve the deadline for a given call: explicit override wins, else thinking
   *  vs non-thinking derivation. Exposed shape kept simple for unit assertions. */
  private timeoutFor(options?: LlmOptions): number {
    if (options?.timeoutMs) return options.timeoutMs;
    if (this.explicitTimeoutMs) return this.explicitTimeoutMs;
    return options?.thinking?.type === 'enabled' ? THINKING_TIMEOUT_MS : NON_THINKING_TIMEOUT_MS;
  }

  async chat(messages: LlmMessage[], options?: LlmOptions): Promise<string> {
    const timeoutMs = this.timeoutFor(options);
    return this.withInstrumentation('LLM chat', (signal) => this.inner.chat(messages, { ...options, signal }), timeoutMs);
  }

  async chatWithTools(messages: LlmMessage[], tools: ToolDefinition[], options?: LlmOptions): Promise<LlmResponse> {
    const timeoutMs = this.timeoutFor(options);
    return this.withInstrumentation(
      'LLM chatWithTools',
      (signal) => this.inner.chatWithTools(messages, tools, { ...options, signal }),
      timeoutMs,
      { toolCount: tools.length },
      options?.signal,
    );
  }

  private async withInstrumentation<T>(
    label: string,
    fn: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    extra?: Record<string, unknown>,
    callerSignal?: AbortSignal,
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await this.withRetry(() => this.withTimeout(fn, timeoutMs, callerSignal));
      this.logger.log({ msg: label, durationMs: Date.now() - start, timeoutMs, ...extra });
      this.onSuccess?.();
      return result;
    } catch (err) {
      this.logger.error({ msg: `${label} failed`, durationMs: Date.now() - start, timeoutMs, error: (err as Error).message });
      this.onFailure?.((err as Error).message);
      throw err;
    }
  }

  /**
   * Run one attempt under a deadline. A FRESH AbortController is created per call
   * (this method is invoked once per retry attempt from withRetry), so a retried
   * attempt never inherits an already-aborted signal. On deadline OR caller abort
   * the controller fires, cancelling the underlying fetch — closing the concurrent
   * in-flight leak. The deadline rejects with a tagged (non-retryable) LlmTimeoutError.
   */
  private async withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number, callerSignal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort(); // cancel the in-flight request, don't just abandon it
        reject(new LlmTimeoutError(timeoutMs));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
      };
      fn(controller.signal).then(
        (result) => { cleanup(); resolve(result); },
        (err) => { cleanup(); reject(err); },
      );
    });
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err)) break;
        if (attempt === this.maxRetries) break;
        const delay = this.retryBaseDelayMs * 2 ** (attempt - 1);
        const jitter = 1 + (Math.random() - 0.5) * 0.5; // ±25%
        const delayWithJitter = Math.round(delay * jitter);
        this.logger.warn(`LLM call failed (attempt ${attempt}/${this.maxRetries}), retrying in ${delayWithJitter}ms: ${(err as Error)?.message}`);
        await new Promise(r => setTimeout(r, delayWithJitter));
      }
    }
    throw lastErr;
  }
}
