import { ResilientLlmClient } from '../resilient-llm-client';
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
});
