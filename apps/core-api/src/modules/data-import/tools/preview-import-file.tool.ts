import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from '../../agent/tools/tool.interface';
import { ReadFilePreviewTool } from '../../agent/tools/read-file-preview.tool';
import { PendingActionService } from '../../pending-action/pending-action.service';
import { InlineTransform, InlineTransformEngine } from '../inline-transform-engine';

@Injectable()
export class PreviewImportFileTool implements AgentTool {
  name = 'preview_import_file';
  description =
    '根据文件ID预览导入效果：推断列映射和转换规则，创建待确认的导入动作。返回 actionId 和前10行预览数据。';
  parameters = {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: '上传的文件 ID' },
      objectType: { type: 'string', description: '目标对象类型名称' },
      conversationId: { type: 'string', description: '关联的对话ID（可选）' },
      transforms: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            column: { type: 'string' },
            op: { type: 'string', enum: ['multiply', 'divide', 'map', 'compute'] },
            arg: {},
            outputColumn: { type: 'string' },
          },
          required: ['column', 'op'],
          additionalProperties: false,
        },
        description: '转换规则数组（可选，不传则不做转换）',
      },
      mapping: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: '列映射 { 源列名: 目标字段名 }（可选，不传则保持原列名）',
      },
    },
    required: ['fileId', 'objectType'],
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(
    private readonly readFilePreview: ReadFilePreviewTool,
    private readonly pendingActionService: PendingActionService,
  ) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const fileId = args.fileId as string;
    const objectType = args.objectType as string;
    const conversationId = args.conversationId as string | undefined;
    const transforms = (args.transforms as InlineTransform[]) || [];
    const mapping = (args.mapping as Record<string, string>) || {};

    // 1. Get file preview (headers + sample rows + totalRows)
    const preview = await this.readFilePreview.execute({ fileId }, context) as any;

    // 2. Apply transforms to sample rows
    const transformed = transforms.length > 0
      ? InlineTransformEngine.apply(preview.sampleRows, transforms)
      : preview.sampleRows;

    // 3. Apply column mapping to preview rows
    const previewRows = transformed.map((row: Record<string, unknown>) => {
      const out: Record<string, unknown> = { ...row };
      for (const [src, dst] of Object.entries(mapping)) {
        if (src in out) {
          out[dst] = out[src];
          delete out[src];
        }
      }
      return out;
    });

    // 4. Create PendingAction
    const action = await this.pendingActionService.propose(
      context.user.tenantId,
      context.user.id,
      {
        conversationId,
        type: 'agent_import',
        payload: { fileId, objectType, transforms, mapping, totalRows: preview.totalRows },
        summary: `Import ${preview.totalRows} rows into ${objectType}`,
      },
    );

    return {
      actionId: action.id,
      objectType,
      transforms,
      mapping,
      previewRows: previewRows.slice(0, 10),
      totalRows: preview.totalRows,
    };
  }
}
