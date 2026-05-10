import { Logger } from '@nestjs/common';
import type { LlmClient, LlmMessage, LlmOptions, LlmResponse, ToolDefinition } from './llm-client.interface';

export interface ResilientLlmOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

export class ResilientLlmClient implements LlmClient {
  private readonly logger = new Logger(ResilientLlmClient.name);
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(
    private readonly inner: LlmClient,
    options?: ResilientLlmOptions,
  ) {
    this.timeoutMs = options?.timeoutMs ?? (Number(process.env.LLM_TIMEOUT_MS) || 30000);
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryBaseDelayMs = options?.retryBaseDelayMs ?? 200;
  }

  async chat(messages: LlmMessage[], options?: LlmOptions): Promise<string> {
    return this.withRetry(() => this.withTimeout(() => this.inner.chat(messages, options)));
  }

  async chatWithTools(messages: LlmMessage[], tools: ToolDefinition[], options?: LlmOptions): Promise<LlmResponse> {
    const start = Date.now();
    try {
      const result = await this.withRetry(() => this.withTimeout(() => this.inner.chatWithTools(messages, tools, options)));
      this.logger.log({ msg: 'LLM chatWithTools', durationMs: Date.now() - start, toolCount: tools.length });
      return result;
    } catch (err) {
      this.logger.error({ msg: 'LLM chatWithTools failed', durationMs: Date.now() - start, error: (err as Error).message });
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
        if (attempt === this.maxRetries) break;
        const delay = this.retryBaseDelayMs * 2 ** (attempt - 1);
        this.logger.warn(`LLM call failed (attempt ${attempt}/${this.maxRetries}), retrying in ${delay}ms: ${(err as Error)?.message}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }
}
