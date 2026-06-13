import { Test, TestingModule } from '@nestjs/testing';
import { PreviewImportFileTool } from './preview-import-file.tool';
import { ReadFilePreviewTool } from '../../agent/tools/read-file-preview.tool';
import { PendingActionService } from '../../pending-action/pending-action.service';
import { ToolContext } from '../../agent/tools/tool.interface';

describe('PreviewImportFileTool', () => {
  let tool: PreviewImportFileTool;
  let readFilePreview: jest.Mocked<ReadFilePreviewTool>;
  let pendingActionService: jest.Mocked<PendingActionService>;

  const mockContext: ToolContext = {
    user: { id: 'user1', tenantId: 'tenant1', email: 'test@example.com' } as any,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreviewImportFileTool,
        {
          provide: ReadFilePreviewTool,
          useValue: {
            execute: jest.fn(),
          },
        },
        {
          provide: PendingActionService,
          useValue: {
            propose: jest.fn(),
          },
        },
      ],
    }).compile();

    tool = module.get(PreviewImportFileTool);
    readFilePreview = module.get(ReadFilePreviewTool);
    pendingActionService = module.get(PendingActionService);
  });

  it('creates PendingAction with correct payload', async () => {
    readFilePreview.execute.mockResolvedValue({
      fileName: 'test.csv',
      headers: ['col1', 'col2'],
      sampleRows: [{ col1: 'a', col2: 'b' }],
      totalRows: 100,
    });

    pendingActionService.propose.mockResolvedValue({
      id: 'action1',
      tenantId: 'tenant1',
      type: 'agent_import',
      status: 'proposed',
      payload: {},
      summary: 'Import 100 rows into Customer',
      createdBy: 'user1',
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await tool.execute(
      {
        fileId: 'file1.csv',
        objectType: 'Customer',
        conversationId: 'conv1',
        transforms: [],
        mapping: {},
      },
      mockContext,
    );

    expect(pendingActionService.propose).toHaveBeenCalledWith('tenant1', 'user1', {
      conversationId: 'conv1',
      type: 'agent_import',
      payload: {
        fileId: 'file1.csv',
        objectType: 'Customer',
        transforms: [],
        mapping: {},
        totalRows: 100,
      },
      summary: 'Import 100 rows into Customer',
    });

    expect(result).toMatchObject({
      actionId: 'action1',
      objectType: 'Customer',
      totalRows: 100,
    });
  });

  it('applies transforms to sampleRows in preview', async () => {
    readFilePreview.execute.mockResolvedValue({
      fileName: 'test.csv',
      headers: ['price'],
      sampleRows: [{ price: 100 }, { price: 200 }],
      totalRows: 2,
    });

    pendingActionService.propose.mockResolvedValue({ id: 'action1' } as any);

    const result: any = await tool.execute(
      {
        fileId: 'file1.csv',
        objectType: 'Product',
        transforms: [{ column: 'price', op: 'multiply', arg: 10 }],
        mapping: {},
      },
      mockContext,
    );

    expect(result.previewRows).toEqual([{ price: 1000 }, { price: 2000 }]);
  });

  it('applies column mapping to preview rows', async () => {
    readFilePreview.execute.mockResolvedValue({
      fileName: 'test.csv',
      headers: ['old_name'],
      sampleRows: [{ old_name: 'value1' }, { old_name: 'value2' }],
      totalRows: 2,
    });

    pendingActionService.propose.mockResolvedValue({ id: 'action1' } as any);

    const result: any = await tool.execute(
      {
        fileId: 'file1.csv',
        objectType: 'Product',
        transforms: [],
        mapping: { old_name: 'new_name' },
      },
      mockContext,
    );

    expect(result.previewRows).toEqual([{ new_name: 'value1' }, { new_name: 'value2' }]);
    expect(result.previewRows[0]).not.toHaveProperty('old_name');
  });
});
