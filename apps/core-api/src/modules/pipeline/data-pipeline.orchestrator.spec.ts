import { DataPipelineOrchestrator } from './data-pipeline.orchestrator';

const T = 'tenant-1';

function make(opts: { pipelines?: any[]; mapping?: any } = {}) {
  const pipelines = opts.pipelines ?? [
    { id: 'pipe-1', tenantId: T, connectorId: 'c-1', outputObjectTypeId: 'ot-1', status: 'active' },
  ];
  const mapping = opts.mapping ?? { id: 'm-1', tenantId: T, objectTypeId: 'ot-1' };

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
      findFirst: jest.fn(async () => ({ id: 'ds-raw-1', tenantId: T, connectorId: 'c-1', kind: 'raw' })),
    },
  };

  const orchestrator = new DataPipelineOrchestrator(prisma, pipelineRunService, syncJobService);
  return { orchestrator, pipelineRunService, syncJobService, prisma };
}

describe('DataPipelineOrchestrator', () => {
  it('onRawDatasetReady enqueues PipelineRun for each active pipeline', async () => {
    const { orchestrator, pipelineRunService } = make({
      pipelines: [
        { id: 'pipe-1', tenantId: T, connectorId: 'c-1', outputObjectTypeId: 'ot-1', status: 'active' },
        { id: 'pipe-2', tenantId: T, connectorId: 'c-1', outputObjectTypeId: 'ot-2', status: 'active' },
      ],
    });
    await orchestrator.onRawDatasetReady(T, 'ds-raw-1');
    expect(pipelineRunService.enqueue).toHaveBeenCalledTimes(2);
    expect(pipelineRunService.enqueue).toHaveBeenCalledWith(T, 'pipe-1', 'ds-raw-1');
    expect(pipelineRunService.enqueue).toHaveBeenCalledWith(T, 'pipe-2', 'ds-raw-1');
  });

  it('onRawDatasetReady does nothing when no pipelines exist', async () => {
    const { orchestrator, pipelineRunService } = make({ pipelines: [] });
    await orchestrator.onRawDatasetReady(T, 'ds-raw-1');
    expect(pipelineRunService.enqueue).not.toHaveBeenCalled();
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
