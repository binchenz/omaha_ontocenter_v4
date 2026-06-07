import { Logger } from '@nestjs/common';
import type { LlmClient, LlmMessage, LlmOptions, LlmResponse, ToolDefinition } from './llm-client.interface';

/** Classify whether an error is worth retrying (transient) or fatal (4xx client error). */
export function isRetryable(error: unknown): boolean {
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
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly onSuccess?: () => void;
  private readonly onFailure?: (error: string) => void;

  constructor(
    private readonly inner: LlmClient,
    options?: ResilientLlmOptions,
  ) {
    this.timeoutMs = options?.timeoutMs ?? (Number(process.env.LLM_TIMEOUT_MS) || 30000);
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryBaseDelayMs = options?.retryBaseDelayMs ?? 200;
    this.onSuccess = options?.onSuccess;
    this.onFailure = options?.onFailure;
  }

  async chat(messages: LlmMessage[], options?: LlmOptions): Promise<string> {
    return this.withInstrumentation('LLM chat', () => this.inner.chat(messages, options));
  }

  async chatWithTools(messages: LlmMessage[], tools: ToolDefinition[], options?: LlmOptions): Promise<LlmResponse> {
    return this.withInstrumentation('LLM chatWithTools', () => this.inner.chatWithTools(messages, tools, options), { toolCount: tools.length });
  }

  private async withInstrumentation<T>(label: string, fn: () => Promise<T>, extra?: Record<string, unknown>): Promise<T> {
    const start = Date.now();
    try {
      const result = await this.withRetry(() => this.withTimeout(fn));
      this.logger.log({ msg: label, durationMs: Date.now() - start, ...extra });
      this.onSuccess?.();
      return result;
    } catch (err) {
      this.logger.error({ msg: `${label} failed`, durationMs: Date.now() - start, error: (err as Error).message });
      this.onFailure?.((err as Error).message);
      throw err;
    }
  }

  private async withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`LLM call timeout after ${this.timeoutMs}ms`)), this.timeoutMs);
      fn().then(
        (result) => { clearTimeout(timer); resolve(result); },
        (err) => { clearTimeout(timer); reject(err); },
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
