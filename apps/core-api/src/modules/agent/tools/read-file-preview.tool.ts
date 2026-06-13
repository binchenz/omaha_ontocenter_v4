import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { FileParserService } from './file-parser.service';
import { UPLOAD_DIR } from '../sdk/import-engine.service';
import * as path from 'path';
import * as fs from 'fs';

interface ReadFilePreviewInput {
  fileId: string;
}

interface ReadFilePreviewOutput {
  fileName: string;
  headers: string[];
  sampleRows: Record<string, unknown>[];
  totalRows: number;
}

@Injectable()
export class ReadFilePreviewTool implements AgentTool {
  name = 'read_file_preview';
  description = '读取上传文件的预览（前10行）。返回文件名、列名、样本行和总行数。支持 Excel (.xlsx) 和 CSV 格式。';
  parameters = {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: '文件 ID（从 /files/upload 接口返回）',
      },
    },
    required: ['fileId'],
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(private readonly fileParser: FileParserService) {}

  async execute(args: Record<string, unknown>, _context?: ToolContext): Promise<unknown> {
    const { fileId } = args as unknown as ReadFilePreviewInput;

    // Validate file extension
    const ext = path.extname(fileId).toLowerCase();
    const allowedExtensions = ['.csv', '.xlsx', '.xls'];
    if (!allowedExtensions.includes(ext)) {
      throw new BadRequestException('Unsupported file format');
    }

    const filePath = path.join(UPLOAD_DIR, fileId);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }

    try {
      const parsed = await this.fileParser.parse(filePath);

      return {
        fileName: fileId,
        headers: parsed.columns.map(c => c.name),
        sampleRows: parsed.sampleRows,
        totalRows: parsed.totalRows,
      };
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        throw new NotFoundException('File not found');
      }
      throw error;
    }
  }
}
