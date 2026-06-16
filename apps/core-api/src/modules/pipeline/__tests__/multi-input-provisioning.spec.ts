import { PipelineService } from '../pipeline.service';
import { DataPipelineOrchestrator } from '../data-pipeline.orchestrator';
import { makeTransformConfigServiceMock } from '../transform-config.mock';

const T = 'tenant-1';

/**
 * Round-trip acceptance for #187: a two-input Pipeline authored through PipelineService.configurePipeline
 * must be reachable end-to-end by the join-barrier. The two services share one in-memory store so the
 * rows the service WRITES (PipelineInput) are the rows the orchestrator READS — closing the gap where
 * the barrier was tested only against hand-mocked declared inputs.
 */
function makeStore() {
  const pipelines: any[] = [];
  const pipelineInputs: any[] = [];
  const steps: any[] = [];
  const datasets: any[] = [];
  let seq = 0;

  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    pipeline: {
      create: jest.fn(async ({ data }: any) => {
        const p = { id: `pipe-${++seq}`, alignKey: null, ...data };
        pipelines.push(p);
        return p;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        pipelines.filter((p) => {
          if (p.tenantId !== where.tenantId || p.status !== where.status) return false;
          // OR: own connector OR a declared input names the connector.
          const cid = where.OR[0].connectorId;
          const own = p.connectorId === cid;
          const declared = pipelineInputs.some((pi) => pi.pipelineId === p.id && pi.connectorId === cid);
          return own || declared;
        }),
      ),
    },
    pipelineInput: {
      createMany: jest.fn(async ({ data }: any) => {
        pipelineInputs.push(...data.map((d: any, i: number) => ({ id: `pi-${seq}-${i}`, ...d })));
        return { count: data.length };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        pipelineInputs.filter((pi) => pi.pipelineId === where.pipelineId),
      ),
    },
    pipelineStep: {
      create: jest.fn(async ({ data }: any) => {
        const s = { id: `s-${++seq}`, ...data };
        steps.push(s);
        return s;
      }),
    },
    dataset: {
      findFirst: jest.fn(async ({ where }: any) => datasets.find((d) => d.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) =>
        datasets
          .filter((d) => d.connectorId === where.connectorId && d.kind === 'raw' && d.status === 'ready')
          .sort((a, b) => a.createdAt - b.createdAt),
      ),
    },
  };

  const { service: transformConfigService } = makeTransformConfigServiceMock([]);
  const pipelineService = new PipelineService(prisma, transformConfigService);
  const pipelineRunService: any = { enqueue: jest.fn(async () => ({ id: 'run-1' })) };
  const syncJobService: any = { enqueue: jest.fn() };
  const orchestrator = new DataPipelineOrchestrator(prisma, pipelineRunService, syncJobService);

  return { pipelineService, orchestrator, pipelineRunService, datasets };
}

describe('multi-input provisioning round-trip (#187)', () => {
  it('configures a two-input pipeline, then fires exactly one PipelineRun once both inputs are ready', async () => {
    const { pipelineService, orchestrator, pipelineRunService, datasets } = makeStore();

    // 1. Author the fact×fact pipeline with two declared inputs.
    const { pipelineId } = await pipelineService.configurePipeline(T, {
      name: 'order_net',
      connectorId: 'c-orders',
      outputObjectTypeId: 'ot-net',
      steps: [],
      declaredInputs: [
        { inputName: 'orders', connectorId: 'c-orders' },
        { inputName: 'refunds', connectorId: 'c-refunds' },
      ],
    });

    // 2. First input (orders) readies → barrier should hold (refunds not ready).
    datasets.push({ id: 'ds-orders-1', tenantId: T, connectorId: 'c-orders', kind: 'raw', status: 'ready', alignKeyValue: null, createdAt: new Date(1) });
    await orchestrator.onRawDatasetReady(T, 'ds-orders-1');
    expect(pipelineRunService.enqueue).not.toHaveBeenCalled();

    // 3. Second input (refunds) readies → barrier fires exactly once, carrying both datasets.
    datasets.push({ id: 'ds-refunds-1', tenantId: T, connectorId: 'c-refunds', kind: 'raw', status: 'ready', alignKeyValue: null, createdAt: new Date(2) });
    await orchestrator.onRawDatasetReady(T, 'ds-refunds-1');

    expect(pipelineRunService.enqueue).toHaveBeenCalledTimes(1);
    const [, firedPipelineId, inputs] = pipelineRunService.enqueue.mock.calls[0];
    expect(firedPipelineId).toBe(pipelineId);
    expect([...inputs].sort()).toEqual(['ds-orders-1', 'ds-refunds-1']);
  });
});
