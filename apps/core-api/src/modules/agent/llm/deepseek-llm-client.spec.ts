import { DeepSeekLlmClient } from './deepseek-llm-client';
import { Logger } from '@nestjs/common';

describe('DeepSeekLlmClient', () => {
  let client: DeepSeekLlmClient;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    client = new DeepSeekLlmClient();
  });

  afterEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
  });

  describe('chatWithTools', () => {
    it('returns tool_calls when LLM decides to call a tool', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'query_objects',
                  arguments: JSON.stringify({ objectType: 'customer', filters: [{ field: 'region', operator: 'eq', value: '华东' }] }),
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        }),
      });

      const result = await client.chatWithTools(
        [
          { role: 'system', content: 'You are a query builder.' },
          { role: 'user', content: '找出华东地区的客户' },
        ],
        [{
          name: 'query_objects',
          description: 'Query object instances',
          parameters: { type: 'object', properties: { objectType: { type: 'string' } } },
        }],
      );

      expect(result.type).toBe('tool_calls');
      if (result.type === 'tool_calls') {
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0].name).toBe('query_objects');
        expect(result.calls[0].id).toBe('call_123');
        expect(result.calls[0].arguments).toEqual({
          objectType: 'customer',
          filters: [{ field: 'region', operator: 'eq', value: '华东' }],
        });
      }
    });

    it('returns text when LLM responds without tool calls', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: '我需要更多信息来帮你查询。',
              tool_calls: undefined,
            },
            finish_reason: 'stop',
          }],
        }),
      });

      const result = await client.chatWithTools(
        [{ role: 'user', content: '你好' }],
        [{ name: 'query_objects', description: 'Query', parameters: {} }],
      );

      expect(result.type).toBe('text');
      if (result.type === 'text') {
        expect(result.content).toBe('我需要更多信息来帮你查询。');
      }
    });

    it('sends tools in OpenAI-compatible format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
      });

      await client.chatWithTools(
        [{ role: 'user', content: 'test' }],
        [{
          name: 'query_objects',
          description: 'Query object instances',
          parameters: { type: 'object', properties: {} },
        }],
        { temperature: 0 },
      );

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.deepseek.com/chat/completions');
      const body = JSON.parse(options.body);
      expect(body.tools).toEqual([{
        type: 'function',
        function: {
          name: 'query_objects',
          description: 'Query object instances',
          parameters: { type: 'object', properties: {} },
        },
      }]);
      expect(body.temperature).toBe(0);
      expect(options.headers['Authorization']).toBe('Bearer test-key');
    });

    it('logs prompt_tokens from the response usage field', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1234, completion_tokens: 5, total_tokens: 1239 },
        }),
      });

      await client.chatWithTools(
        [{ role: 'user', content: 'test' }],
        [{ name: 'query_objects', description: 'Query', parameters: {} }],
      );

      expect(logSpy).toHaveBeenCalled();
      const msg = logSpy.mock.calls.map(c => c[0]).join(' ');
      expect(msg).toContain('1234');
      logSpy.mockRestore();
    });
  });
});
