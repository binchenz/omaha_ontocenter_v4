import { DataPipelineOrchestrator } from './data-pipeline.orchestrator';

const T = 'tenant-1';

function make(opts: { pipelines?: any[]; mapping?: any; pipelineInputs?: any[]; datasets?: any[] } = {}) {
  const pipelines = opts.pipelines ?? [
    { id: 'pipe-1', tenantId: T, connectorId: 'c-1', outputObjectTypeId: 'ot-1', status: 'active', alignKey: null },
  ];
  const mapping = opts.mapping ?? { id: 'm-1', tenantId: T, objectTypeId: 'ot-1' };
  // Declared inputs per pipeline (explicit multi-input). Empty → implicit single-input by connector.
  const pipelineInputs = opts.pipelineInputs ?? [];
  // The raw Dataset store the orchestrator scans for ready versions per input connector. Defaults to
  // the single just-ready raw Dataset used by the legacy single-input tests.
  const datasets = opts.datasets ?? [
    { id: 'ds-raw-1', tenantId: T, connectorId: 'c-1', kind: 'raw', status: 'ready', version: 1, alignKeyValue: null, createdAt: new Date(1) },
  ];

  const pipelineRunService: any = {
    enqueue: jest.fn(async () => ({ id: 'run-1' })),
  };
  const syncJobService: any = {
    enqueue: jest.fn(async () => ({ id: 'sj-1' })),
  };
  const prisma: any = {
    pipeline: {
      findMany: jest.fn(async () => pipelines.filter((p: any) => p.status === 'active')),
      findFirstOrThrow: jest.fn(async () => pipelines[0] ?? null),
    },
    pipelineInput: {
      findMany: jest.fn(async ({ where }: any) =>
        pipelineInputs.filter((pi: any) => pi.pipelineId === where.pipelineId),
      ),
    },
    pipelineRun: {
      findFirstOrThrow: jest.fn(async () => ({
        id: 'run-1',
        tenantId: T,
        pipelineId: 'pipe-1',
        outputDatasetId: 'ds-clean-1',
      })),
    },
    objectMapping: {
      findFirst: jest.fn(async () => mapping),
    },
    dataset: {
      findFirst: jest.fn(async ({ where }: any) => datasets.find((d: any) => d.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) =>
        datasets
          .filter((d: any) => d.connectorId === where.connectorId && d.kind === 'raw' && d.status === 'ready')
          .sort((a: any, b: any) => a.createdAt - b.createdAt),
      ),
    },
  };

  const orchestrator = new DataPipelineOrchestrator(prisma, pipelineRunService, syncJobService);
  return { orchestrator, pipelineRunService, syncJobService, prisma };
}

describe('DataPipelineOrchestrator', () => {
  it('onRawDatasetReady enqueues PipelineRun for each active single-input pipeline (no regression)', async () => {
    const { orchestrator, pipelineRunService } = make({
      pipelines: [
        { id: 'pipe-1', tenantId: T, connectorId: 'c-1', outputObjectTypeId: 'ot-1', status: 'active' },
        { id: 'pipe-2', tenantId: T, connectorId: 'c-1', outputObjectTypeId: 'ot-2', status: 'active' },
      ],
    });
    await orchestrator.onRawDatasetReady(T, 'ds-raw-1');
    expect(pipelineRunService.enqueue).toHaveBeenCalledTimes(2);
    // Single-input pipeline still fires immediately with the just-ready dataset — model 1′ with a
    // one-element input set returns fire=true. The enqueue carries a one-element input set.
    expect(pipelineRunService.enqueue).toHaveBeenCalledWith(T, 'pipe-1', ['ds-raw-1']);
    expect(pipelineRunService.enqueue).toHaveBeenCalledWith(T, 'pipe-2', ['ds-raw-1']);
  });

  it('onRawDatasetReady does nothing when no pipelines exist', async () => {
    const { orchestrator, pipelineRunService } = make({ pipelines: [] });
    await orchestrator.onRawDatasetReady(T, 'ds-raw-1');
    expect(pipelineRunService.enqueue).not.toHaveBeenCalled();
  });

  it('holds the join-barrier (no enqueue) when a pipeline declares alignKey but the input carries no key value', async () => {
    // A keyed pipeline whose just-ready input has no extractable alignKeyValue cannot be safely
    // paired, so the barrier holds rather than firing a possibly-mis-aligned run.
    const { orchestrator, pipelineRunService } = make({
      pipelines: [
        { id: 'pipe-keyed', tenantId: T, connectorId: 'c-1', outputObjectTypeId: 'ot-1', status: 'active', alignKey: 'reportMonth' },
      ],
    });
    await orchestrator.onRawDatasetReady(T, 'ds-raw-1');
    expect(pipelineRunService.enqueue).not.toHaveBeenCalled();
  });

  describe('multi-input join-barrier (#186, declared inputs)', () => {
    // A fact×fact pipeline declaring two inputs: orders (connector c-orders) + refunds (c-refunds).
    const twoInputPipeline = {
      id: 'pipe-join', tenantId: T, connectorId: 'c-orders', outputObjectTypeId: 'ot-net', status: 'active', alignKey: null,
    };
    const declaredInputs = [
      { id: 'pi-1', tenantId: T, pipelineId: 'pipe-join', inputName: 'orders', connectorId: 'c-orders', alignKeyField: null },
      { id: 'pi-2', tenantId: T, pipelineId: 'pipe-join', inputName: 'refunds', connectorId: 'c-refunds', alignKeyField: null },
    ];

    it('holds the barrier when only the first of two declared inputs is ready', async () => {
      const { orchestrator, pipelineRunService } = make({
        pipelines: [twoInputPipeline],
        pipelineInputs: declaredInputs,
        datasets: [
          { id: 'ds-orders-1', tenantId: T, connectorId: 'c-orders', kind: 'raw', status: 'ready', version: 1, alignKeyValue: null, createdAt: new Date(1) },
          // refunds not yet ready
        ],
      });
      await orchestrator.onRawDatasetReady(T, 'ds-orders-1');
      expect(pipelineRunService.enqueue).not.toHaveBeenCalled();
    });

    it('fires once both declared inputs are ready, carrying both input datasets', async () => {
      const { orchestrator, pipelineRunService } = make({
        pipelines: [twoInputPipeline],
        pipelineInputs: declaredInputs,
        datasets: [
          { id: 'ds-orders-1', tenantId: T, connectorId: 'c-orders', kind: 'raw', status: 'ready', version: 1, alignKeyValue: null, createdAt: new Date(1) },
          { id: 'ds-refunds-1', tenantId: T, connectorId: 'c-refunds', kind: 'raw', status: 'ready', version: 1, alignKeyValue: null, createdAt: new Date(2) },
        ],
      });
      // refunds readies second → barrier should now fire.
      await orchestrator.onRawDatasetReady(T, 'ds-refunds-1');
      expect(pipelineRunService.enqueue).toHaveBeenCalledTimes(1);
      const [, pipelineId, inputs] = pipelineRunService.enqueue.mock.calls[0];
      expect(pipelineId).toBe('pipe-join');
      expect([...inputs].sort()).toEqual(['ds-orders-1', 'ds-refunds-1']);
    });

    it('with alignKey, fires only the same-key versions (6月订单 pairs 6月退款, not 5月)', async () => {
      const keyedPipeline = { ...twoInputPipeline, alignKey: 'reportMonth' };
      const { orchestrator, pipelineRunService } = make({
        pipelines: [keyedPipeline],
        pipelineInputs: declaredInputs,
        datasets: [
          { id: 'ds-orders-may', tenantId: T, connectorId: 'c-orders', kind: 'raw', status: 'ready', version: 1, alignKeyValue: '25.05', createdAt: new Date(1) },
          { id: 'ds-orders-jun', tenantId: T, connectorId: 'c-orders', kind: 'raw', status: 'ready', version: 2, alignKeyValue: '25.06', createdAt: new Date(3) },
          { id: 'ds-refunds-jun', tenantId: T, connectorId: 'c-refunds', kind: 'raw', status: 'ready', version: 1, alignKeyValue: '25.06', createdAt: new Date(4) },
        ],
      });
      await orchestrator.onRawDatasetReady(T, 'ds-refunds-jun');
      expect(pipelineRunService.enqueue).toHaveBeenCalledTimes(1);
      const [, , inputs] = pipelineRunService.enqueue.mock.calls[0];
      // June orders + June refunds — May orders never selected.
      expect([...inputs].sort()).toEqual(['ds-orders-jun', 'ds-refunds-jun']);
    });

    it('with alignKey, holds when only mismatched keys exist (6月订单 vs 5月退款)', async () => {
      const keyedPipeline = { ...twoInputPipeline, alignKey: 'reportMonth' };
      const { orchestrator, pipelineRunService } = make({
        pipelines: [keyedPipeline],
        pipelineInputs: declaredInputs,
        datasets: [
          { id: 'ds-orders-jun', tenantId: T, connectorId: 'c-orders', kind: 'raw', status: 'ready', version: 1, alignKeyValue: '25.06', createdAt: new Date(1) },
          { id: 'ds-refunds-may', tenantId: T, connectorId: 'c-refunds', kind: 'raw', status: 'ready', version: 1, alignKeyValue: '25.05', createdAt: new Date(2) },
        ],
      });
      await orchestrator.onRawDatasetReady(T, 'ds-refunds-may');
      expect(pipelineRunService.enqueue).not.toHaveBeenCalled();
    });
  });

  it('onPipelineRunComplete enqueues SyncJob with mappingId', async () => {
    const { orchestrator, syncJobService } = make();
    await orchestrator.onPipelineRunComplete(T, 'run-1');
    expect(syncJobService.enqueue).toHaveBeenCalledWith(T, 'ds-clean-1', 'm-1');
  });

  it('onPipelineRunComplete skips SyncJob when no mapping exists', async () => {
    const { orchestrator, syncJobService, prisma } = make({ mapping: null });
    prisma.objectMapping.findFirst.mockResolvedValueOnce(null);
    await orchestrator.onPipelineRunComplete(T, 'run-1');
    expect(syncJobService.enqueue).not.toHaveBeenCalled();
  });

  it('onPipelineRunComplete filters mapping by connectorId to avoid ambiguity', async () => {
    // Bug scenario: same ObjectType has mappings from multiple Connectors
    const mapping1 = { id: 'm-connector-1', tenantId: T, connectorId: 'c-1', objectTypeId: 'ot-1' };
    const mapping2 = { id: 'm-connector-2', tenantId: T, connectorId: 'c-2', objectTypeId: 'ot-1' };

    const { orchestrator, syncJobService, prisma } = make({
      pipelines: [
        { id: 'pipe-1', tenantId: T, connectorId: 'c-1', outputObjectTypeId: 'ot-1', status: 'active' },
      ],
    });

    // Mock: database has both mappings, but findFirst should filter by connectorId
    prisma.objectMapping.findFirst.mockResolvedValueOnce(mapping1);

    await orchestrator.onPipelineRunComplete(T, 'run-1');

    // Verify it looked up with connectorId filter
    expect(prisma.objectMapping.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: T,
        connectorId: 'c-1',  // Must include this
        objectTypeId: 'ot-1',
      },
    });

    // Verify it used the correct mapping
    expect(syncJobService.enqueue).toHaveBeenCalledWith(T, 'ds-clean-1', 'm-connector-1');
  });
});
