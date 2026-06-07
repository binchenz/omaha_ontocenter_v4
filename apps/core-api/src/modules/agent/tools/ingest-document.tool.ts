import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { ResearchSdk } from '../../research/research.sdk';

@Injectable()
export class IngestDocumentTool implements AgentTool {
  name = 'ingest_document';
  description =
    '将一份调研报告 PDF 导入为可语义检索的文档：抽取每页文本、切块、向量化并存储，原文件留存以供引用。需指定上传文件的 fileId、原文件名，以及文档级元数据（品类，可选机构/季度/标题）。切块与向量化自动完成，无需逐块确认。';
  parameters = {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: '上传的 PDF 文件的 fileId' },
      originalName: { type: 'string', description: '原始文件名（用于留存与引用）' },
      category: { type: 'string', description: '文档所属品类（如 电饭煲、空气炸锅、净水器）' },
      agency: { type: 'string', description: '调研机构（如 瑞、品创方略），可选' },
      quarter: { type: 'string', description: '报告周期（如 2025Q2），可选' },
      title: { type: 'string', description: '报告标题，可选' },
    },
    required: ['fileId', 'originalName', 'category', 'agency', 'quarter', 'title'],
    additionalProperties: false,
  };
  requiresConfirmation = true;

  constructor(private readonly sdk: ResearchSdk) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.ingestDocument(context.user, {
      fileId: args.fileId as string,
      originalName: args.originalName as string,
      metadata: {
        category: args.category as string,
        agency: args.agency as string | undefined,
        quarter: args.quarter as string | undefined,
        title: args.title as string | undefined,
      },
    });
  }
}
