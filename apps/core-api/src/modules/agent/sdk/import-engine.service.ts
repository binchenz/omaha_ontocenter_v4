import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { FileParserService } from '../tools/file-parser.service';
import { TypeResolver } from './type-resolver.service';
import * as path from 'path';

export const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

export interface ImportParams {
  filePath: string;
  objectType: string;
  externalIdColumn: string;
  labelColumn: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  objectType: string;
}

@Injectable()
export class ImportEngine {
  constructor(
    private readonly fileParser: FileParserService,
    private readonly typeResolver: TypeResolver,
    private readonly prisma: PrismaService,
  ) {}

  async importFile(tenantId: string, params: ImportParams): Promise<ImportResult> {
    await this.typeResolver.resolve(tenantId, params.objectType);

    const rows = await this.fileParser.parseAll(params.filePath);
    if (rows.length === 0) {
      return { imported: 0, skipped: 0, objectType: params.objectType };
    }

    let imported = 0;

    await this.prisma.$transaction(async (tx: any) => {
      for (const row of rows) {
        const externalId = String(row[params.externalIdColumn] ?? `row_${imported + 1}`);
        const label = String(row[params.labelColumn] ?? externalId);
        const properties: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          properties[key] = value;
        }

        await tx.objectInstance.upsert({
          where: {
            tenantId_objectType_externalId: {
              tenantId,
              objectType: params.objectType,
              externalId,
            },
          },
          create: {
            tenantId,
            objectType: params.objectType,
            externalId,
            label,
            properties: properties as any,
            relationships: {},
          },
          update: {
            label,
            properties: properties as any,
          },
        });
        imported++;
      }
    });

    return { imported, skipped: 0, objectType: params.objectType };
  }
}
