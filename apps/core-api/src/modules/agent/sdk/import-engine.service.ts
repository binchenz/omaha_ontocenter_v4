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

/** A pre-built instance to upsert: the in-memory equivalent of one parsed file row. */
export interface InstanceUpsert {
  externalId: string;
  label: string;
  properties: Record<string, unknown>;
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

    const instances: InstanceUpsert[] = rows.map((row, idx) => {
      const externalId = String(row[params.externalIdColumn] ?? `row_${idx + 1}`);
      return {
        externalId,
        label: String(row[params.labelColumn] ?? externalId),
        properties: { ...row },
      };
    });

    return this.importInstances(tenantId, params.objectType, instances);
  }

  /**
   * Upsert pre-built instances into an Object Type through the single write path
   * (ADR-0040): the allowedValues hard gate, then a transactional batch upsert. Callers
   * that build instances in memory (e.g. the AVC market-metric importer) reuse this rather
   * than introducing a second writer. The Object Type must already exist.
   */
  async importInstances(
    tenantId: string,
    objectTypeName: string,
    instances: InstanceUpsert[],
  ): Promise<ImportResult> {
    if (instances.length === 0) {
      return { imported: 0, skipped: 0, objectType: objectTypeName };
    }

    // Hard gate: reject the whole batch if any value violates a property's
    // allowedValues. Normalization of dirty source data is an upstream concern;
    // the importer only gates (ADR: Property.allowedValues).
    const objectType = await this.prisma.objectType.findFirst({
      where: { tenantId, name: objectTypeName },
      select: { properties: true },
    });
    const propertyDefs = (objectType?.properties ?? []) as unknown as PropertyDefinition[];
    const hasConstraints = propertyDefs.some((p) => p.allowedValues && p.allowedValues.length > 0);
    if (hasConstraints) {
      const violations: Array<AllowedValueViolation & { row: number }> = [];
      instances.forEach((inst, idx) => {
        for (const v of validateInstanceProperties(inst.properties, propertyDefs)) {
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
      for (const inst of instances) {
        await tx.objectInstance.upsert({
          where: {
            tenantId_objectType_externalId: {
              tenantId,
              objectType: objectTypeName,
              externalId: inst.externalId,
            },
          },
          create: {
            tenantId,
            objectType: objectTypeName,
            externalId: inst.externalId,
            label: inst.label,
            properties: inst.properties as any,
            relationships: {},
          },
          update: {
            label: inst.label,
            properties: inst.properties as any,
          },
        });
        imported++;
      }
    });

    return { imported, skipped: 0, objectType: objectTypeName };
  }
}
