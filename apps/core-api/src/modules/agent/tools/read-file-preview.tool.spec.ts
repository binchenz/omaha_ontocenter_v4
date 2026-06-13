import { Test, TestingModule } from '@nestjs/testing';
import { ReadFilePreviewTool } from './read-file-preview.tool';
import { FileParserService } from './file-parser.service';
import * as path from 'path';
import * as fs from 'fs';

jest.mock('fs');

describe('ReadFilePreviewTool', () => {
  let tool: ReadFilePreviewTool;
  let fileParser: FileParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadFilePreviewTool,
        {
          provide: FileParserService,
          useValue: {
            parse: jest.fn(),
          },
        },
      ],
    }).compile();

    tool = module.get<ReadFilePreviewTool>(ReadFilePreviewTool);
    fileParser = module.get<FileParserService>(FileParserService);

    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should return file preview with headers and sample rows', async () => {
      const fileId = 'test-file.xlsx';
      const mockParsed = {
        columns: [
          { name: '零售额(万元)', inferredType: 'number' as const },
          { name: '品牌', inferredType: 'string' as const },
        ],
        sampleRows: [
          { '零售额(万元)': 123.4, '品牌': '美的' },
          { '零售额(万元)': 567.8, '品牌': '海尔' },
        ],
        totalRows: 50,
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fileParser.parse as jest.Mock).mockResolvedValue(mockParsed);

      const result = await tool.execute({ fileId });

      expect(result).toEqual({
        fileName: fileId,
        headers: ['零售额(万元)', '品牌'],
        sampleRows: mockParsed.sampleRows,
        totalRows: 50,
      });
    });

    it('should throw error if file does not exist', async () => {
      const fileId = 'nonexistent.xlsx';

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(tool.execute({ fileId })).rejects.toThrow('File not found');
    });

    it('should throw error for unsupported file format', async () => {
      const fileId = 'test.txt';

      await expect(tool.execute({ fileId })).rejects.toThrow('Unsupported file format');
    });
  });
});
