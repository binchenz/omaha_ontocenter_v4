import { consumeQueue } from './pg-boss.provider';

/**
 * consumeQueue black-box spec. This deep module owns the one load-bearing pg-boss v10 invariant —
 * createQueue() MUST complete before work(), or send() silently drops jobs — so the rule is tested
 * once here against the seam rather than re-derived in every worker's onModuleInit.
 */
describe('consumeQueue', () => {
  function makeBoss() {
    return { createQueue: jest.fn(async () => {}), work: jest.fn(async () => {}) } as any;
  }

  it('creates the queue before working it (pg-boss v10 requires createQueue first)', async () => {
    const boss = makeBoss();
    await consumeQueue(boss, 'my-queue', async () => {});
    expect(boss.createQueue).toHaveBeenCalledWith('my-queue');
    expect(boss.work).toHaveBeenCalledWith('my-queue', expect.any(Function));
    expect(boss.createQueue.mock.invocationCallOrder[0]).toBeLessThan(boss.work.mock.invocationCallOrder[0]);
  });

  it('dispatches each job in a delivered batch to the handler', async () => {
    const boss = makeBoss();
    const handled: string[] = [];
    boss.work.mockImplementation(async (_q: string, fn: (jobs: any[]) => Promise<void>) => {
      await fn([{ data: { id: 'a' } }, { data: { id: 'b' } }]);
    });
    await consumeQueue<{ id: string }>(boss, 'q', async (job) => { handled.push(job.data.id); });
    expect(handled).toEqual(['a', 'b']);
  });
});
