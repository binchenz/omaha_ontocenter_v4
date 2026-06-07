import { DeepSeekLlmClient } from '../deepseek-llm-client';

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function mockResponse(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  };
}

describe('DeepSeekLlmClient V4 migration (#135)', () => {
  let client: DeepSeekLlmClient;

  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    client = new DeepSeekLlmClient();
    mockFetch.mockReset();
  });

  describe('base URL and model defaults', () => {
    it('uses beta endpoint', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        choices: [{ message: { content: 'Hello' } }],
        usage: { prompt_tokens: 10 },
      }));

      await client.chat([{ role: 'user', content: 'Hi' }]);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.deepseek.com/beta/chat/completions');
    });

    it('defaults to deepseek-v4-flash model', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        choices: [{ message: { content: 'Hello' } }],
        usage: { prompt_tokens: 10 },
      }));

      await client.chat([{ role: 'user', content: 'Hi' }]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('deepseek-v4-flash');
    });
  });

  describe('model override', () => {
    it('uses options.model when provided', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        choices: [{ message: { content: 'Deep thought' } }],
        usage: { prompt_tokens: 10 },
      }));

      await client.chat([{ role: 'user', content: 'Hi' }], { model: 'deepseek-v4-pro' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('deepseek-v4-pro');
    });
  });

  describe('thinking mode', () => {
    it('includes thinking and reasoning_effort when thinking is enabled', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        choices: [{ message: { content: 'Answer', reasoning_content: 'Let me think...' } }],
        usage: { prompt_tokens: 10 },
      }));

      await client.chat([{ role: 'user', content: 'Complex question' }], {
        model: 'deepseek-v4-pro',
        thinking: { type: 'enabled' },
        reasoningEffort: 'high',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinking).toEqual({ type: 'enabled' });
      expect(body.reasoning_effort).toBe('high');
    });

    it('does NOT send temperature when thinking is enabled', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        choices: [{ message: { content: 'Answer' } }],
        usage: { prompt_tokens: 10 },
      }));

      await client.chat([{ role: 'user', content: 'Q' }], {
        temperature: 0.7,
        thinking: { type: 'enabled' },
        reasoningEffort: 'high',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBeUndefined();
    });

    it('does NOT include thinking params when thinking is disabled/omitted', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        choices: [{ message: { content: 'Quick answer' } }],
        usage: { prompt_tokens: 10 },
      }));

      await client.chat([{ role: 'user', content: 'Q' }], { temperature: 0.5 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinking).toBeUndefined();
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.temperature).toBe(0.5);
    });
  });

  describe('reasoning_content parsing', () => {
    it('chat() returns content only (reasoning_content discarded for simple interface)', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        choices: [{ message: { content: 'Final answer', reasoning_content: 'Thinking...' } }],
        usage: { prompt_tokens: 10 },
      }));

      const result = await client.chat([{ role: 'user', content: 'Q' }]);
      expect(result).toBe('Final answer');
    });

    it('chatWithTools() text response includes reasoning_content', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        choices: [{ message: { content: 'Answer', reasoning_content: 'Step by step...' } }],
        usage: { prompt_tokens: 10 },
      }));

      const result = await client.chatWithTools(
        [{ role: 'user', content: 'Q' }],
        [{ name: 'test', description: 'test', parameters: {} }],
      );

      expect(result).toEqual({
        type: 'text',
        content: 'Answer',
        reasoning_content: 'Step by step...',
      });
    });

    it('chatWithTools() tool_calls response includes reasoning_content', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        choices: [{
          message: {
            content: null,
            reasoning_content: 'I need to query data',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'query', arguments: '{"x":1}' } }],
          },
        }],
        usage: { prompt_tokens: 10 },
      }));

      const result = await client.chatWithTools(
        [{ role: 'user', content: 'Q' }],
        [{ name: 'query', description: 'query', parameters: {} }],
      );

      expect(result).toEqual({
        type: 'tool_calls',
        calls: [{ id: 'call_1', name: 'query', arguments: { x: 1 } }],
        reasoning_content: 'I need to query data',
      });
    });

    it('chatWithTools() omits reasoning_content when not present in response', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        choices: [{ message: { content: 'Answer' } }],
        usage: { prompt_tokens: 10 },
      }));

      const result = await client.chatWithTools(
        [{ role: 'user', content: 'Q' }],
        [{ name: 'test', description: 'test', parameters: {} }],
      );

      expect(result).toEqual({ type: 'text', content: 'Answer' });
      expect((result as any).reasoning_content).toBeUndefined();
    });
  });

  describe('reasoning_content in messages (round-trip)', () => {
    it('includes reasoning_content on assistant messages sent to API', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        choices: [{ message: { content: 'Next step' } }],
        usage: { prompt_tokens: 10 },
      }));

      await client.chat([
        { role: 'user', content: 'Q' },
        { role: 'assistant', content: null, reasoning_content: 'Thought process', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'test', arguments: '{}' } }] },
        { role: 'tool', content: '{"result": 42}', tool_call_id: 'c1' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
      expect(assistantMsg.reasoning_content).toBe('Thought process');
    });
  });

  describe('strict tool definitions', () => {
    it('passes strict flag on tool definitions to API', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        choices: [{ message: { content: 'Done' } }],
        usage: { prompt_tokens: 10 },
      }));

      await client.chatWithTools(
        [{ role: 'user', content: 'Q' }],
        [{ name: 'test_tool', description: 'Test', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true }],
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools[0]).toEqual({
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'Test',
          strict: true,
          parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        },
      });
    });
  });
});
