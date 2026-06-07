import { CreateActionTool } from '../tools/create-action.tool';
import { ExecuteActionTool } from '../tools/execute-action.tool';

describe('CreateActionTool', () => {
  let tool: CreateActionTool;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      actionDefinition: {
        create: jest.fn().mockResolvedValue({ id: 'def-1', name: 'mark_followed_up' }),
      },
    };
    tool = new CreateActionTool(mockPrisma);
  });

  it('has correct name and requiresConfirmation', () => {
    expect(tool.name).toBe('create_action');
    expect(tool.requiresConfirmation).toBe(true);
  });

  it('creates an ActionDefinition and returns success message', async () => {
    const context = { user: { tenantId: 't-1', id: 'u-1', permissions: ['*'] } } as any;
    const result = await tool.execute({
      name: 'mark_followed_up',
      label: '标记为已跟进',
      description: '将市场指标标记为已跟进状态',
      objectTypeName: 'market_metric',
      parameters: [],
      effects: [{ type: 'set_field', field: 'status', value: '已跟进' }],
    }, context);

    expect(mockPrisma.actionDefinition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't-1',
        name: 'mark_followed_up',
        objectType: 'market_metric',
        effects: [{ type: 'set_field', field: 'status', value: '已跟进' }],
      }),
    });
    expect((result as any).message).toContain('标记为已跟进');
  });
});

describe('ExecuteActionTool', () => {
  let tool: ExecuteActionTool;
  let mockExecutor: any;

  beforeEach(() => {
    mockExecutor = {
      execute: jest.fn(),
    };
    tool = new ExecuteActionTool(mockExecutor);
  });

  it('has correct name and requiresConfirmation', () => {
    expect(tool.name).toBe('execute_action');
    expect(tool.requiresConfirmation).toBe(true);
  });

  it('returns success with changes on successful execution', async () => {
    mockExecutor.execute.mockResolvedValue({
      ok: true,
      changes: [{ type: 'set_field', field: 'status', from: '待跟进', to: '已跟进' }],
    });
    const context = { user: { tenantId: 't-1', id: 'u-1', permissions: ['*'] } } as any;

    const result = await tool.execute({
      actionName: 'mark_followed_up',
      objectId: 'obj-1',
      params: {},
    }, context);

    expect(mockExecutor.execute).toHaveBeenCalledWith('t-1', 'u-1', 'mark_followed_up', 'obj-1', {});
    expect((result as any).message).toContain('执行成功');
    expect((result as any).changes).toHaveLength(1);
  });

  it('returns error on failed execution', async () => {
    mockExecutor.execute.mockResolvedValue({
      ok: false,
      error: 'Action "nonexistent" 不存在',
    });
    const context = { user: { tenantId: 't-1', id: 'u-1', permissions: ['*'] } } as any;

    const result = await tool.execute({
      actionName: 'nonexistent',
      objectId: 'obj-1',
    }, context);

    expect((result as any).error).toContain('不存在');
  });
});
