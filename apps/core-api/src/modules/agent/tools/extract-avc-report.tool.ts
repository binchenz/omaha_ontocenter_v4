import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { CoreSdkService } from '../../sdk/core-sdk.service';

@Injectable()
export class ExtractAvcReportTool implements AgentTool {
  name = 'extract_avc_report';
  description =
    '解析一份 AVC（奥维云网）线上市场月度监测 Excel 报告，将其市场规模指标（零售额/零售量/零售均价等）按品类与月份导入为市场指标对象，之后即可用 query/aggregate 查询趋势。需指定上传文件的 fileId 和报告所属品类。';
  parameters = {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: '上传的 AVC 报告文件的 fileId' },
      category: { type: 'string', description: '报告所属品类（如 电饭煲、空气炸锅、净水器）' },
    },
    required: ['fileId', 'category'],
  };
  requiresConfirmation = true;

  constructor(private readonly sdk: CoreSdkService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.extractAvcReport(context.user, {
      fileId: args.fileId as string,
      category: args.category as string,
    });
  }
}
