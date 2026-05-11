import { SseAgentRunner } from '../sse-agent-runner.service';
import { AgentEvent } from '../../../orchestrator/orchestrator.service';

class FakeResponse {
  public headers: Record<string, string> = {};
  public chunks: string[] = [];
  public flushed = false;
  public ended = false;

  setHeader(k: string, v: string): void {
    this.headers[k] = v;
  }
  flushHeaders(): void {
    this.flushed = true;
  }
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  end(): void {
    this.ended = true;
  }
}

function parseWritten(res: FakeResponse): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const chunk of res.chunks) {
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      out.push(JSON.parse(line.slice(6)));
    }
  }
  return out;
}

async function* makeGenerator(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const e of events) yield e;
}

async function* throwingGenerator(events: AgentEvent[], err: Error): AsyncGenerator<AgentEvent> {
  for (const e of events) yield e;
  throw err;
}

describe('SseAgentRunner', () => {
  const addTurn = jest.fn();
  const conversationService = { addTurn } as any;
  let runner: SseAgentRunner;

  beforeEach(() => {
    jest.clearAllMocks();
    runner = new SseAgentRunner(conversationService);
  });

  it('sets SSE headers, flushes them, and ends the response exactly once', async () => {
    const res = new FakeResponse();
    await runner.stream(res as any, makeGenerator([
      { type: 'text', content: 'hi' },
      { type: 'done', conversationId: 'conv-1' },
    ]), 'conv-1');

    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['Cache-Control']).toBe('no-cache');
    expect(res.headers['Connection']).toBe('keep-alive');
    expect(res.flushed).toBe(true);
    expect(res.ended).toBe(true);
  });

  it('writes every event from the generator in order', async () => {
    const res = new FakeResponse();
    const events: AgentEvent[] = [
      { type: 'tool_call', id: 'c1', name: 'query_objects', args: {} },
      { type: 'tool_result', id: 'c1', name: 'query_objects', data: { meta: { total: 3 } } },
      { type: 'text', content: '3 results' },
      { type: 'done', conversationId: 'conv-1' },
    ];
    await runner.stream(res as any, makeGenerator(events), 'conv-1');

    const written = parseWritten(res);
    expect(written.map(e => e.type)).toEqual(['tool_call', 'tool_result', 'text', 'done']);
  });

  it('persists the assistant turn with accumulated tool calls/results and final text', async () => {
    const res = new FakeResponse();
    await runner.stream(res as any, makeGenerator([
      { type: 'tool_call', id: 'c1', name: 'query_objects', args: { foo: 1 } },
      { type: 'tool_result', id: 'c1', name: 'query_objects', data: { rows: [] } },
      { type: 'text', content: 'final answer' },
      { type: 'done', conversationId: 'conv-1' },
    ]), 'conv-1');

    expect(addTurn).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      role: 'assistant',
      content: 'final answer',
      toolCalls: [{ id: 'c1', name: 'query_objects', args: { foo: 1 } }],
      toolResults: [{ id: 'c1', name: 'query_objects', data: { rows: [] } }],
    }));
  });

  it('persists null content and undefined tool fields when only a text event was emitted', async () => {
    const res = new FakeResponse();
    await runner.stream(res as any, makeGenerator([
      { type: 'text', content: 'just text' },
      { type: 'done', conversationId: 'conv-1' },
    ]), 'conv-1');

    expect(addTurn).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      role: 'assistant',
      content: 'just text',
    }));
    const call = addTurn.mock.calls[0][1];
    expect(call.toolCalls).toBeUndefined();
    expect(call.toolResults).toBeUndefined();
  });

  it('emits a synthetic done event after a generator throws', async () => {
    const res = new FakeResponse();
    await runner.stream(
      res as any,
      throwingGenerator([{ type: 'tool_call', id: 'c1', name: 'foo', args: {} }], new Error('boom')),
      'conv-1',
    );

    const written = parseWritten(res);
    const types = written.map(e => e.type);
    expect(types).toContain('error');
    expect(types).toContain('done');
    // Error must come before done
    expect(types.indexOf('error')).toBeLessThan(types.indexOf('done'));
    expect(res.ended).toBe(true);
  });

  it('error event carries the thrown error message', async () => {
    const res = new FakeResponse();
    await runner.stream(
      res as any,
      throwingGenerator([], new Error('something went wrong')),
      'conv-1',
    );

    const written = parseWritten(res);
    const errorEvent = written.find(e => e.type === 'error') as any;
    expect(errorEvent?.message).toBe('something went wrong');
  });
});
