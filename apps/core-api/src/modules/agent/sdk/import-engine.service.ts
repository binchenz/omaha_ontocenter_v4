import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { PropertyDefinition, validateInstanceProperties, AllowedValueViolation } from '@omaha/shared-types';
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

    // Hard gate: reject the whole batch if any value violates a property's
    // allowedValues. Normalization of dirty source data is an upstream concern;
    // the importer only gates (ADR: Property.allowedValues).
    const objectType = await this.prisma.objectType.findFirst({
      where: { tenantId, name: params.objectType },
      select: { properties: true },
    });
    const propertyDefs = (objectType?.properties ?? []) as unknown as PropertyDefinition[];
    const hasConstraints = propertyDefs.some((p) => p.allowedValues && p.allowedValues.length > 0);
    if (hasConstraints) {
      const violations: Array<AllowedValueViolation & { row: number }> = [];
      rows.forEach((row, idx) => {
        for (const v of validateInstanceProperties(row as Record<string, unknown>, propertyDefs)) {
          violations.push({ ...v, row: idx + 1 });
        }
      });
      if (violations.length > 0) {
        const preview = violations.slice(0, 5)
          .map((v) => `第${v.row}行 ${v.field}="${v.value}"（合法值：${v.allowed.join('/')}）`)
          .join('；');
        throw new BadRequestException(
          `导入被拒绝：${violations.length} 处值不在字段的合法值范围内。请先在数据源/ETL 中规范化后再导入。示例：${preview}`,
        );
      }
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
