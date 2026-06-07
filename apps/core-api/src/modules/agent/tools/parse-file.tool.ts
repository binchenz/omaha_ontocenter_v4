import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { AgentTool } from './tool.interface';
import { FileParserService } from './file-parser.service';
import { UPLOAD_DIR } from '../sdk/import-engine.service';

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
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(private readonly fileParser: FileParserService) {}

  async execute(args: Record<string, unknown>): Promise<unknown> {
    return this.fileParser.parse(path.join(UPLOAD_DIR, args.fileId as string));
  }
}
