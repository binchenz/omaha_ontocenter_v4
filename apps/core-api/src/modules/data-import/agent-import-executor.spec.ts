import { AgentImportExecutor, AgentImportPayload } from './agent-import-executor';
import { InlineTransformEngine } from './inline-transform-engine';

const tenantId = 'tenant-1';
const actionId = 'action-1';

const basePayload: AgentImportPayload = {
  fileId: 'file.csv',
  objectType: 'Product',
  transforms: [],
  mapping: { '零售额': 'retailValue' },
  totalRows: 2,
};

const rawRows = [{ '零售额': '100', name: 'A' }, { '零售额': '200', name: 'B' }];

function makeExecutor(overrides: Partial<{
  parseAll: jest.Mock;
  appendRows: jest.Mock;
  markCompleted: jest.Mock;
  markFailed: jest.Mock;
}> = {}) {
  const fileParser = { parseAll: overrides.parseAll ?? jest.fn().mockResolvedValue(rawRows) };
  const datasetService = {
    createDataset: jest.fn().mockResolvedValue({ id: 'ds-1' }),
    appendRows: overrides.appendRows ?? jest.fn().mockResolvedValue(undefined),
    markReady: jest.fn().mockResolvedValue(undefined),
  };
  const syncJobService = { enqueue: jest.fn().mockResolvedValue({ id: 'sj-1' }) };
  const pendingActionService = {
    markExecuting: jest.fn().mockResolvedValue(undefined),
    markCompleted: overrides.markCompleted ?? jest.fn().mockResolvedValue(undefined),
    markFailed: overrides.markFailed ?? jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    connector: { upsert: jest.fn().mockResolvedValue({ id: 'conn-1' }) },
    objectType: { findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'ot-1' }) },
    objectMapping: { upsert: jest.fn().mockResolvedValue({ id: 'om-1' }) },
  };

  const executor = new AgentImportExecutor(
    prisma as any,
    fileParser as any,
    datasetService as any,
    syncJobService as any,
    pendingActionService as any,
  );

  return { executor, fileParser, datasetService, syncJobService, pendingActionService, prisma };
}

describe('AgentImportExecutor', () => {
  it('calls InlineTransformEngine.apply with the given transforms', async () => {
    const spy = jest.spyOn(InlineTransformEngine, 'apply');
    const transforms = [{ column: '零售额', op: 'multiply' as const, arg: 1 }];
    const { executor } = makeExecutor();
    await executor.execute(tenantId, actionId, { ...basePayload, transforms });
    expect(spy).toHaveBeenCalledWith(rawRows, transforms);
    spy.mockRestore();
  });

  it('renames columns according to mapping before appending rows', async () => {
    const appendRows = jest.fn().mockResolvedValue(undefined);
    const { executor } = makeExecutor({ appendRows });
    await executor.execute(tenantId, actionId, basePayload);
    const written: Record<string, unknown>[] = appendRows.mock.calls[0][2];
    expect(written[0]).toHaveProperty('retailValue', '100');
    expect(written[0]).not.toHaveProperty('零售额');
  });

  it('calls DatasetService.appendRows with transformed+renamed rows', async () => {
    const appendRows = jest.fn().mockResolvedValue(undefined);
    const { executor, datasetService } = makeExecutor({ appendRows });
    await executor.execute(tenantId, actionId, basePayload);
    expect(datasetService.appendRows).toHaveBeenCalledWith(tenantId, 'ds-1', expect.any(Array));
  });

  it('calls PendingActionService.markCompleted on success', async () => {
    const markCompleted = jest.fn().mockResolvedValue(undefined);
    const { executor } = makeExecutor({ markCompleted });
    await executor.execute(tenantId, actionId, basePayload);
    expect(markCompleted).toHaveBeenCalledWith(tenantId, actionId, { syncJobId: 'sj-1', rowsQueued: 2 });
  });

  it('calls PendingActionService.markFailed on error', async () => {
    const markFailed = jest.fn().mockResolvedValue(undefined);
    const parseAll = jest.fn().mockRejectedValue(new Error('parse error'));
    const { executor } = makeExecutor({ parseAll, markFailed });
    await executor.execute(tenantId, actionId, basePayload);
    expect(markFailed).toHaveBeenCalledWith(tenantId, actionId, 'parse error');
  });
});
