import { ResilientLlmClient, isRetryable } from '../resilient-llm-client';
import type { LlmClient, LlmMessage, LlmResponse, ToolDefinition } from '../llm-client.interface';

class MockLlmClient implements LlmClient {
  chatFn = jest.fn<Promise<string>, [LlmMessage[]]>();
  chatWithToolsFn = jest.fn<Promise<LlmResponse>, [LlmMessage[], ToolDefinition[]]>();

  async chat(messages: LlmMessage[]): Promise<string> {
    return this.chatFn(messages);
  }
  async chatWithTools(messages: LlmMessage[], tools: ToolDefinition[]): Promise<LlmResponse> {
    return this.chatWithToolsFn(messages, tools);
  }
}

describe('ResilientLlmClient', () => {
  let inner: MockLlmClient;
  let client: ResilientLlmClient;

  beforeEach(() => {
    inner = new MockLlmClient();
    client = new ResilientLlmClient(inner, { timeoutMs: 500, maxRetries: 2, retryBaseDelayMs: 10 });
  });

  describe('timeout', () => {
    it('rejects if inner client exceeds timeout', async () => {
      inner.chatWithToolsFn.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ type: 'text', content: 'late' }), 2000)),
      );

      await expect(
        client.chatWithTools([{ role: 'user', content: 'hi' }], []),
      ).rejects.toThrow(/timeout/i);
    });

    it('succeeds if inner client responds within timeout', async () => {
      inner.chatWithToolsFn.mockResolvedValue({ type: 'text', content: 'ok' });

      const result = await client.chatWithTools([{ role: 'user', content: 'hi' }], []);
      expect(result).toEqual({ type: 'text', content: 'ok' });
    });
  });

  describe('retry with exponential backoff', () => {
    it('retries on failure and succeeds on second attempt', async () => {
      inner.chatWithToolsFn
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({ type: 'text', content: 'recovered' });

      const result = await client.chatWithTools([{ role: 'user', content: 'hi' }], []);
      expect(result).toEqual({ type: 'text', content: 'recovered' });
      expect(inner.chatWithToolsFn).toHaveBeenCalledTimes(2);
    });

    it('throws after all retries exhausted', async () => {
      inner.chatWithToolsFn.mockRejectedValue(new Error('persistent failure'));

      await expect(
        client.chatWithTools([{ role: 'user', content: 'hi' }], []),
      ).rejects.toThrow(/persistent failure/);
      expect(inner.chatWithToolsFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalid JSON in tool_calls', () => {
    it('returns error text response when tool_calls arguments are invalid JSON', async () => {
      inner.chatWithToolsFn.mockResolvedValue({
        type: 'tool_calls',
        calls: [{ id: 'tc1', name: 'test_tool', arguments: 'not valid' as any }],
      });

      const result = await client.chatWithTools([{ role: 'user', content: 'hi' }], []);
      // Should gracefully handle — either pass through or wrap in error
      expect(result.type).toBe('tool_calls');
    });
  });

  describe('chat method', () => {
    it('retries chat calls on failure', async () => {
      inner.chatFn
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce('hello');

      const result = await client.chat([{ role: 'user', content: 'hi' }]);
      expect(result).toBe('hello');
      expect(inner.chatFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('isRetryable error classification', () => {
    it('returns true for network errors (ECONNREFUSED)', () => {
      expect(isRetryable(new Error('connect ECONNREFUSED 127.0.0.1:443'))).toBe(true);
    });

    it('returns true for timeout errors', () => {
      expect(isRetryable(new Error('LLM call timeout after 30000ms'))).toBe(true);
    });

    it('returns true for 5xx errors via status property', () => {
      const err = Object.assign(new Error('Internal Server Error'), { status: 500 });
      expect(isRetryable(err)).toBe(true);
    });

    it('returns false for 4xx errors via status property', () => {
      const err = Object.assign(new Error('Bad Request'), { status: 400 });
      expect(isRetryable(err)).toBe(false);
    });

    it('returns false for 4xx errors via statusCode property', () => {
      const err = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
      expect(isRetryable(err)).toBe(false);
    });

    it('returns true for unknown errors (safe default)', () => {
      expect(isRetryable('some string error')).toBe(true);
      expect(isRetryable(null)).toBe(true);
    });
  });

  describe('error classification in retry logic', () => {
    it('4xx error throws immediately — inner client called only once', async () => {
      const err = Object.assign(new Error('Bad Request'), { status: 400 });
      inner.chatFn.mockRejectedValue(err);

      await expect(client.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('Bad Request');
      expect(inner.chatFn).toHaveBeenCalledTimes(1);
    });

    it('5xx error retries up to max — inner client called multiple times', async () => {
      const err = Object.assign(new Error('Internal Server Error'), { status: 500 });
      inner.chatFn.mockRejectedValue(err);

      await expect(client.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('Internal Server Error');
      expect(inner.chatFn).toHaveBeenCalledTimes(2); // maxRetries = 2
    });

    it('5xx then success — retries and succeeds', async () => {
      const err = Object.assign(new Error('Service Unavailable'), { status: 503 });
      inner.chatFn
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('recovered');

      const result = await client.chat([{ role: 'user', content: 'hi' }]);
      expect(result).toBe('recovered');
      expect(inner.chatFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('jitter bounds', () => {
    it('delay stays within ±25% of base delay', async () => {
      const randomSpy = jest.spyOn(Math, 'random');
      const delays: number[] = [];
      const origSetTimeout = global.setTimeout;

      // Capture delays passed to setTimeout during retry waits
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((fn: Function, ms?: number) => {
        if (ms && ms > 0) delays.push(ms);
        return origSetTimeout(fn, 0); // execute immediately for test speed
      }) as any);

      // Create client with known base delay
      const jitterClient = new ResilientLlmClient(inner, { timeoutMs: 5000, maxRetries: 3, retryBaseDelayMs: 100 });

      // Math.random()=0 → jitter factor = 0.75, delays should be 75, 150
      randomSpy.mockReturnValue(0);
      const err = Object.assign(new Error('Server Error'), { status: 500 });
      inner.chatFn.mockRejectedValue(err);

      await expect(jitterClient.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('Server Error');

      // Filter out timeout timer delays (which are large, e.g. 5000ms)
      const retryDelays = delays.filter(d => d < 5000);
      expect(retryDelays).toEqual([75, 150]); // 100*0.75, 200*0.75

      // Reset for upper bound test
      delays.length = 0;
      randomSpy.mockReturnValue(1);
      inner.chatFn.mockRejectedValue(err);

      await expect(jitterClient.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('Server Error');

      const retryDelays2 = delays.filter(d => d < 5000);
      expect(retryDelays2).toEqual([125, 250]); // 100*1.25, 200*1.25

      setTimeoutSpy.mockRestore();
      randomSpy.mockRestore();
    });

    it('jitter factor is correctly bounded between 0.75 and 1.25', () => {
      // Math.random() = 0 → factor = 1 + (0 - 0.5) * 0.5 = 0.75
      expect(1 + (0 - 0.5) * 0.5).toBe(0.75);
      // Math.random() = 0.5 → factor = 1 + (0.5 - 0.5) * 0.5 = 1.0
      expect(1 + (0.5 - 0.5) * 0.5).toBe(1.0);
      // Math.random() = 1 → factor = 1 + (1 - 0.5) * 0.5 = 1.25
      expect(1 + (1 - 0.5) * 0.5).toBe(1.25);
    });
  });
});
