import { Injectable, Logger } from '@nestjs/common';
import { LlmClient, LlmMessage, LlmOptions, LlmResponse, ToolDefinition } from './llm-client.interface';
import { dumpLlmCall } from './llm-debug';

@Injectable()
export class DeepSeekLlmClient implements LlmClient {
  private readonly logger = new Logger(DeepSeekLlmClient.name);
  private readonly apiUrl = 'https://api.deepseek.com/beta/chat/completions';
  private readonly defaultModel = 'deepseek-v4-flash';

  async chat(messages: LlmMessage[], options?: LlmOptions): Promise<string> {
    const res = await this.callApi(messages, undefined, options);
    return res.choices[0].message.content ?? '';
  }

  async chatWithTools(messages: LlmMessage[], tools: ToolDefinition[], options?: LlmOptions): Promise<LlmResponse> {
    const res = await this.callApi(messages, tools, options);
    const message = res.choices[0].message;
    const reasoningContent: string | undefined = message.reasoning_content || undefined;

    if (message.tool_calls?.length) {
      const result: LlmResponse = {
        type: 'tool_calls',
        calls: message.tool_calls.map((tc: any) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })),
      };
      if (reasoningContent) result.reasoning_content = reasoningContent;
      return result;
    }

    const result: LlmResponse = { type: 'text', content: message.content ?? '' };
    if (reasoningContent) result.reasoning_content = reasoningContent;
    return result;
  }

  private async callApi(messages: LlmMessage[], tools?: ToolDefinition[], options?: LlmOptions) {
    const model = options?.model ?? this.defaultModel;
    const thinkingEnabled = options?.thinking?.type === 'enabled';

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
        return msg;
      }),
    };

    if (tools?.length) {
      body.tools = tools.map(t => {
        const fn: Record<string, unknown> = { name: t.name, description: t.description, parameters: t.parameters };
        if (t.strict) fn.strict = true;
        return { type: 'function', function: fn };
      });
    }

    // Thinking mode: include thinking/reasoning_effort, suppress temperature/top_p
    if (thinkingEnabled) {
      body.thinking = options!.thinking;
      if (options!.reasoningEffort) body.reasoning_effort = options!.reasoningEffort;
    } else {
      if (options?.temperature !== undefined) body.temperature = options.temperature;
    }

    if (options?.jsonMode) body.response_format = { type: 'json_object' };

    const start = Date.now();
    const debugRequest = { model, messages: body.messages, tools: body.tools };
    let res: Response;
    try {
      res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network-level failure (fetch failed / abort): capture the request that
      // was about to go out so prompt debugging survives connection errors.
      dumpLlmCall({ request: debugRequest, error: (err as Error).message, durationMs: Date.now() - start });
      throw err;
    }

    if (!res.ok) {
      const err = await res.text();
      dumpLlmCall({ request: debugRequest, error: `DeepSeek API error ${res.status}: ${err}`, durationMs: Date.now() - start });
      throw new Error(`DeepSeek API error ${res.status}: ${err}`);
    }

    const json = await res.json();
    const promptTokens = json?.usage?.prompt_tokens;
    if (typeof promptTokens === 'number') {
      this.logger.log(`DeepSeek call: prompt_tokens=${promptTokens}`);
    }
    dumpLlmCall({
      request: debugRequest,
      response: json,
      durationMs: Date.now() - start,
      promptTokens: typeof promptTokens === 'number' ? promptTokens : undefined,
    });
    return json;
  }
}
