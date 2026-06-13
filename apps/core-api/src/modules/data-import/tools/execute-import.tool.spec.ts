import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { ExecuteImportTool } from './execute-import.tool';
import { AgentImportExecutor } from '../agent-import-executor';
import { ToolContext } from '../../agent/tools/tool.interface';

describe('ExecuteImportTool', () => {
  let tool: ExecuteImportTool;
  let mockPrisma: any;
  let executor: jest.Mocked<AgentImportExecutor>;

  const mockContext: ToolContext = {
    user: { id: 'user1', tenantId: 'tenant1', email: 'test@example.com' } as any,
  };

  beforeEach(async () => {
    mockPrisma = {
      pendingAction: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecuteImportTool,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: AgentImportExecutor,
          useValue: {
            execute: jest.fn(),
          },
        },
      ],
    }).compile();

    tool = module.get(ExecuteImportTool);
    executor = module.get(AgentImportExecutor);
  });

  it('throws ConflictException if action not approved', async () => {
    mockPrisma.pendingAction.findUnique.mockResolvedValue({
      id: 'action1',
      tenantId: 'tenant1',
      status: 'proposed',
      payload: {},
    } as any);

    await expect(
      tool.execute({ actionId: 'action1' }, mockContext),
    ).rejects.toThrow(ConflictException);
    await expect(
      tool.execute({ actionId: 'action1' }, mockContext),
    ).rejects.toThrow('Action must be approved before execution');
  });

  it('calls AgentImportExecutor if action is approved', async () => {
    const mockPayload = {
      fileId: 'file1.csv',
      objectType: 'Customer',
      transforms: [],
      mapping: {},
      totalRows: 100,
    };

    mockPrisma.pendingAction.findUnique.mockResolvedValue({
      id: 'action1',
      tenantId: 'tenant1',
      status: 'approved',
      payload: mockPayload,
    } as any);

    executor.execute.mockResolvedValue(undefined);

    const result = await tool.execute({ actionId: 'action1' }, mockContext);

    expect(executor.execute).toHaveBeenCalledWith('tenant1', 'action1', mockPayload);
    expect(result).toEqual({
      message: '导入已排队',
      actionId: 'action1',
    });
  });
});
