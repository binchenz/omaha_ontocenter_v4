import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { FileParserService } from './file-parser.service';
import { UPLOAD_DIR } from '../sdk/import-engine.service';
import * as path from 'path';

@Injectable()
export class ParseFileTool implements AgentTool {
  name = 'parse_file';
  description = '解析上传的文件（Excel/CSV），返回列名、推断的数据类型和样本数据行。';
  parameters = {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: '上传文件返回的 fileId' },
    },
    required: ['fileId'],
  };
  requiresConfirmation = false;

  constructor(private readonly parser: FileParserService) {}

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const fileId = args.fileId as string;
    const filePath = path.join(UPLOAD_DIR, fileId);
    return this.parser.parse(filePath);
  }
}
