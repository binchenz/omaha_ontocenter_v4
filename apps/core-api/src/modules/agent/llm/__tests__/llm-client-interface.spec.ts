/**
 * Compile-time contract tests for the LlmClient interface extensions (Issue #134).
 * These verify the type system accepts the new fields without breaking existing usage.
 */
import type { LlmMessage, LlmOptions, LlmResponse, ToolDefinition } from '../llm-client.interface';

describe('LlmClient interface extensions (#134)', () => {
  describe('LlmMessage', () => {
    it('accepts reasoning_content on assistant messages', () => {
      const msg: LlmMessage = {
        role: 'assistant',
        content: 'Final answer',
        reasoning_content: 'Let me think step by step...',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'test', arguments: '{}' } }],
      };
      expect(msg.reasoning_content).toBe('Let me think step by step...');
    });

    it('allows reasoning_content to be omitted (backward compat)', () => {
      const msg: LlmMessage = { role: 'assistant', content: 'Hello' };
      expect(msg.reasoning_content).toBeUndefined();
    });
  });

  describe('LlmOptions', () => {
    it('accepts model override', () => {
      const opts: LlmOptions = { model: 'deepseek-v4-pro' };
      expect(opts.model).toBe('deepseek-v4-pro');
    });

    it('accepts thinking configuration', () => {
      const opts: LlmOptions = {
        thinking: { type: 'enabled' },
        reasoningEffort: 'high',
      };
      expect(opts.thinking?.type).toBe('enabled');
      expect(opts.reasoningEffort).toBe('high');
    });

    it('allows all new fields to be omitted (backward compat)', () => {
      const opts: LlmOptions = { temperature: 0.7 };
      expect(opts.model).toBeUndefined();
      expect(opts.thinking).toBeUndefined();
      expect(opts.reasoningEffort).toBeUndefined();
    });
  });

  describe('LlmResponse', () => {
    it('text response carries optional reasoning_content', () => {
      const res: LlmResponse = {
        type: 'text',
        content: 'Answer',
        reasoning_content: 'Thinking...',
      };
      expect(res.type).toBe('text');
      if (res.type === 'text') {
        expect(res.reasoning_content).toBe('Thinking...');
      }
    });

    it('tool_calls response carries optional reasoning_content', () => {
      const res: LlmResponse = {
        type: 'tool_calls',
        calls: [{ id: '1', name: 'test', arguments: {} }],
        reasoning_content: 'I need to call a tool',
      };
      expect(res.type).toBe('tool_calls');
      if (res.type === 'tool_calls') {
        expect(res.reasoning_content).toBe('I need to call a tool');
      }
    });

    it('allows reasoning_content to be omitted on responses (backward compat)', () => {
      const res: LlmResponse = { type: 'text', content: 'Hello' };
      if (res.type === 'text') {
        expect(res.reasoning_content).toBeUndefined();
      }
    });
  });

  describe('ToolDefinition', () => {
    it('accepts strict flag', () => {
      const tool: ToolDefinition = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: true,
      };
      expect(tool.strict).toBe(true);
    });

    it('allows strict to be omitted (backward compat)', () => {
      const tool: ToolDefinition = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
      };
      expect(tool.strict).toBeUndefined();
    });
  });
});
