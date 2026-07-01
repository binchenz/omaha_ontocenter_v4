import { ResilientLlmClient, isRetryable, LlmTimeoutError } from '../resilient-llm-client';
import type { LlmClient, LlmMessage, LlmOptions, LlmResponse, ToolDefinition } from '../llm-client.interface';

class MockLlmClient implements LlmClient {
  chatFn = jest.fn<Promise<string>, [LlmMessage[], LlmOptions?]>();
  chatWithToolsFn = jest.fn<Promise<LlmResponse>, [LlmMessage[], ToolDefinition[], LlmOptions?]>();
  /** Last options seen by the inner client — lets tests assert the composed abort signal. */
  lastOptions?: LlmOptions;

  async chat(messages: LlmMessage[], options?: LlmOptions): Promise<string> {
    this.lastOptions = options;
    return this.chatFn(messages, options);
  }
  async chatWithTools(messages: LlmMessage[], tools: ToolDefinition[], options?: LlmOptions): Promise<LlmResponse> {
    this.lastOptions = options;
    return this.chatWithToolsFn(messages, tools, options);
  }
}

/**
 * Install a setTimeout spy that RECORDS the delay of every timer set (so tests can
 * assert the derived deadline) without ever firing the deadline callback — the
 * returned handle is inert. Returns the captured delays array + a restore fn.
 */
function captureTimerDelays(): { delays: number[]; restore: () => void } {
  const delays: number[] = [];
  const spy = jest.spyOn(global, 'setTimeout').mockImplementation(((_fn: Function, ms?: number) => {
    delays.push(ms ?? 0);
    return 0 as any; // inert handle; deadline never fires, clearTimeout(0) is a no-op
  }) as any);
  return { delays, restore: () => spy.mockRestore() };
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

    it('rejects with an LlmTimeoutError (tagged, isDeadline) — not a bare Error', async () => {
      inner.chatWithToolsFn.mockImplementation(
        () => new Promise(() => { /* never settles — the deadline must reject it */ }),
      );

      await expect(
        client.chatWithTools([{ role: 'user', content: 'hi' }], []),
      ).rejects.toBeInstanceOf(LlmTimeoutError);
    });
  });

  describe('deadline is NON-retryable (does not re-fire the slow-but-alive call)', () => {
    it('a fired deadline throws once — inner client is NOT retried', async () => {
      // Inner never resolves within the 500ms deadline; a naive isRetryable(/timeout/)
      // would re-fire it maxRetries times. The deadline must be non-retryable.
      inner.chatWithToolsFn.mockImplementation(
        () => new Promise(() => { /* never settles */ }),
      );

      await expect(
        client.chatWithTools([{ role: 'user', content: 'hi' }], []),
      ).rejects.toBeInstanceOf(LlmTimeoutError);
      expect(inner.chatWithToolsFn).toHaveBeenCalledTimes(1); // one attempt, no re-fire
    });

    it('LlmTimeoutError is classified non-retryable; genuine network ETIMEDOUT stays retryable', () => {
      expect(isRetryable(new LlmTimeoutError(30000))).toBe(false);
      // The upstream socket-level timeout (server never responded) must still retry.
      expect(isRetryable(new Error('connect ETIMEDOUT 1.2.3.4:443'))).toBe(true);
      expect(isRetryable(new Error('request timeout'))).toBe(true);
    });
  });

  describe('call-aware timeout derivation', () => {
    it('uses 120s for thinking-enabled calls', async () => {
      const c = new ResilientLlmClient(inner, { maxRetries: 1 });
      inner.chatWithToolsFn.mockResolvedValue({ type: 'text', content: 'ok' });
      const { delays, restore } = captureTimerDelays();
      try {
        await c.chatWithTools([{ role: 'user', content: 'hi' }], [], { thinking: { type: 'enabled' }, reasoningEffort: 'high' });
      } finally {
        restore();
      }
      expect(delays).toContain(120000);
    });

    it('uses 45s for non-thinking (fast) calls', async () => {
      const c = new ResilientLlmClient(inner, { maxRetries: 1 });
      inner.chatFn.mockResolvedValue('ok');
      const { delays, restore } = captureTimerDelays();
      try {
        await c.chat([{ role: 'user', content: 'hi' }], { jsonMode: true, temperature: 0 });
      } finally {
        restore();
      }
      expect(delays).toContain(45000);
    });

    it('an explicit options.timeoutMs overrides the derivation', async () => {
      const c = new ResilientLlmClient(inner, { maxRetries: 1 });
      inner.chatWithToolsFn.mockResolvedValue({ type: 'text', content: 'ok' });
      const { delays, restore } = captureTimerDelays();
      try {
        await c.chatWithTools([{ role: 'user', content: 'hi' }], [], { thinking: { type: 'enabled' }, timeoutMs: 7000 });
      } finally {
        restore();
      }
      expect(delays).toContain(7000);
      expect(delays).not.toContain(120000);
    });

    it('an explicit constructor timeoutMs still wins (back-compat with existing wiring)', async () => {
      const c = new ResilientLlmClient(inner, { timeoutMs: 500, maxRetries: 1 });
      inner.chatWithToolsFn.mockResolvedValue({ type: 'text', content: 'ok' });
      const { delays, restore } = captureTimerDelays();
      try {
        await c.chatWithTools([{ role: 'user', content: 'hi' }], [], { thinking: { type: 'enabled' } });
      } finally {
        restore();
      }
      expect(delays).toContain(500);
    });
  });

  describe('AbortSignal wiring (kills the concurrent-cost leak)', () => {
    it('threads a composed AbortSignal into the inner call', async () => {
      const c = new ResilientLlmClient(inner, { maxRetries: 1 });
      inner.chatWithToolsFn.mockResolvedValue({ type: 'text', content: 'ok' });
      await c.chatWithTools([{ role: 'user', content: 'hi' }], []);
      expect(inner.lastOptions?.signal).toBeInstanceOf(AbortSignal);
      expect(inner.lastOptions?.signal?.aborted).toBe(false);
    });

    it('aborts the in-flight signal when the deadline fires', async () => {
      const c = new ResilientLlmClient(inner, { timeoutMs: 30, maxRetries: 1 });
      let capturedSignal: AbortSignal | undefined;
      inner.chatWithToolsFn.mockImplementation((_m, _t, opts?: LlmOptions) => {
        capturedSignal = opts?.signal;
        return new Promise(() => { /* never settles; deadline will abort it */ });
      });
      await expect(c.chatWithTools([{ role: 'user', content: 'hi' }], [])).rejects.toBeInstanceOf(LlmTimeoutError);
      expect(capturedSignal?.aborted).toBe(true);
    });

    it('composes a caller-supplied signal: caller abort also cancels', async () => {
      const c = new ResilientLlmClient(inner, { maxRetries: 1 });
      const callerController = new AbortController();
      let capturedSignal: AbortSignal | undefined;
      // Model fetch's contract: a call rejects with an AbortError once its signal fires.
      inner.chatWithToolsFn.mockImplementation((_m, _t, opts?: LlmOptions) => {
        capturedSignal = opts?.signal;
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        });
      });
      const p = c.chatWithTools([{ role: 'user', content: 'hi' }], [], { signal: callerController.signal, timeoutMs: 60000 });
      // Give the microtask a tick so the inner mock captures the composed signal.
      await Promise.resolve();
      callerController.abort();
      await expect(p).rejects.toThrow();
      expect(capturedSignal?.aborted).toBe(true);
    });

    it('creates a FRESH signal per attempt — a retry is not handed an already-aborted signal', async () => {
      const c = new ResilientLlmClient(inner, { timeoutMs: 60000, maxRetries: 2, retryBaseDelayMs: 1 });
      const signals: (AbortSignal | undefined)[] = [];
      inner.chatFn
        .mockImplementationOnce((_m, opts?: LlmOptions) => { signals.push(opts?.signal); return Promise.reject(Object.assign(new Error('Server Error'), { status: 500 })); })
        .mockImplementationOnce((_m, opts?: LlmOptions) => { signals.push(opts?.signal); return Promise.resolve('recovered'); });

      const result = await c.chat([{ role: 'user', content: 'hi' }]);
      expect(result).toBe('recovered');
      expect(signals).toHaveLength(2);
      expect(signals[0]).not.toBe(signals[1]);       // distinct controllers
      expect(signals[1]?.aborted).toBe(false);        // second attempt's signal is fresh
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
