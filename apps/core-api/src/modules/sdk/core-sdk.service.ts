import { Injectable, ForbiddenException } from '@nestjs/common';
import * as path from 'path';
import { OntologyService } from '../ontology/ontology.service';
import { QueryService } from '../query/query.service';
import { PrismaService } from '@omaha/db';
import { CurrentUser as CurrentUserType, hasCapability } from '@omaha/shared-types';
import { TypeResolver } from '../agent/sdk/type-resolver.service';
import { ConnectorClient } from '../agent/connector/connector-client.service';
import { ImportEngine, UPLOAD_DIR } from '../agent/sdk/import-engine.service';
import { FileParserService } from '../agent/tools/file-parser.service';

export interface OntologySchema {
  types: Array<{
    name: string;
    label: string;
    description?: string;
    properties: Array<{ name: string; type: string; label: string; filterable?: boolean; sortable?: boolean; description?: string; unit?: string; allowedValues?: string[] }>;
    derivedProperties: Array<{ name: string; type: string; label: string }>;
  }>;
  relationships: Array<{
    name: string;
    sourceType: string;
    targetType: string;
    cardinality: string;
    description?: string;
  }>;
}

type PropertyType = 'string' | 'number' | 'boolean' | 'date' | 'json';

function mapPropertyDto(p: { name: string; type: string; label: string; filterable?: boolean; sortable?: boolean; description?: string; unit?: string }) {
  return {
    name: p.name,
    type: p.type as PropertyType,
    label: p.label,
    filterable: p.filterable,
    sortable: p.sortable,
    description: p.description,
    unit: p.unit,
  };
}

@Injectable()
export class CoreSdkService {
  constructor(
    private readonly ontologyService: OntologyService,
    private readonly queryService: QueryService,
    private readonly prisma: PrismaService,
    private readonly typeResolver: TypeResolver,
    private readonly connectorClient: ConnectorClient,
    private readonly importEngine: ImportEngine,
    private readonly fileParser: FileParserService,
  ) {}

  /** The single write-authz gate on the Agent/SDK path (ADR-0040 §4). Pure capability
   * check (no DI scope) so it cannot drift from the HTTP path, which uses the same fn. */
  private assertCapability(actor: CurrentUserType, resource: string, action: string): void {
    if (!hasCapability(actor.permissions ?? [], resource, action)) {
      throw new ForbiddenException(`No permission for ${resource}.${action}`);
    }
  }

  // --- Schema ---

  async getSchema(tenantId: string): Promise<OntologySchema> {
    const [types, relationships] = await Promise.all([
      this.ontologyService.listObjectTypes(tenantId),
      this.ontologyService.listRelationships(tenantId),
    ]);

    return {
      types: types.map((t: any) => ({
        name: t.name,
        label: t.label,
        description: t.description ?? undefined,
        properties: (t.properties ?? []).map((p: any) => ({
          name: p.name, type: p.type, label: p.label, filterable: p.filterable, sortable: p.sortable,
          description: p.description, unit: p.unit, allowedValues: p.allowedValues,
        })),
        derivedProperties: (t.derivedProperties ?? []).map((d: any) => ({
          name: d.name, type: d.type, label: d.label,
        })),
      })),
      relationships: relationships.map((r: any) => ({
        name: r.name,
        sourceType: r.sourceType.name,
        targetType: r.targetType.name,
        cardinality: r.cardinality,
        description: r.description ?? undefined,
      })),
    };
  }

  private schemaSummaryCache = new Map<string, { summary: string; typeNames: string[] }>();

  invalidateSchemaSummary(tenantId: string): void {
    this.schemaSummaryCache.delete(tenantId);
  }

  async getSchemaSummary(tenantId: string): Promise<{ summary: string; typeNames: string[] }> {
    const cached = this.schemaSummaryCache.get(tenantId);
    if (cached) return cached;

    const schema = await this.getSchema(tenantId);
    const typeNames = schema.types.map(t => t.name);
    const lines: string[] = ['数据模型：'];
    const maxTypes = 15;
    const MAX_DESC = 50; // soft-truncate field descriptions to keep prompt budget bounded
    for (const t of schema.types.slice(0, maxTypes)) {
      const typeDesc = t.description ? ` — ${t.description}` : '';
      const props = t.properties
        .filter(p => p.filterable || p.sortable)
        .map(p => {
          let s = `${p.name}:${p.type}`;
          if (p.filterable) s += '✓';
          if (p.sortable) s += '↕';
          if (p.unit) s += `[${p.unit}]`;
          if (p.description) {
            const d = p.description.length > MAX_DESC ? `${p.description.slice(0, MAX_DESC)}…` : p.description;
            s += `{${d}}`;
          }
          if (p.allowedValues && p.allowedValues.length > 0) {
            const shown = p.allowedValues.slice(0, 8).join('|');
            s += `=(${shown}${p.allowedValues.length > 8 ? '|…' : ''})`;
          }
          return s;
        })
        .join(', ');
      lines.push(`- ${t.name}(${props})${typeDesc}`);
    }
    if (schema.relationships.length > 0) {
      const rels = schema.relationships.map(r => {
        const desc = r.description ? `(${r.description})` : '';
        return `${r.sourceType}→${r.targetType}(${r.name})${desc}`;
      }).join(', ');
      lines.push(`关系：${rels}`);
    }
    if (schema.types.length > maxTypes) {
      lines.push(`（共${schema.types.length}个类型，更多请调用 get_ontology_schema）`);
    }
    const result = { summary: lines.join('\n'), typeNames };
    this.schemaSummaryCache.set(tenantId, result);
    return result;
  }

  // --- Query ---

  async queryObjects(user: CurrentUserType, args: {
    objectType: string;
    filters?: any[];
    sort?: any;
    include?: string[];
    page?: number;
    pageSize?: number;
  }) {
    return this.queryService.queryObjects(user, args);
  }

  async aggregateObjects(user: CurrentUserType, args: {
    objectType: string;
    filters?: any[];
    groupBy?: string[];
    metrics: any[];
    orderBy?: any[];
    maxGroups?: number;
    pageToken?: string;
  }) {
    return this.queryService.aggregateObjects(user, args);
  }

  // --- Ontology ---

  async createObjectType(actor: CurrentUserType, dto: {
    name: string;
    label: string;
    description?: string;
    properties: Array<{ name: string; type: string; label: string; filterable?: boolean; sortable?: boolean; description?: string; unit?: string }>;
  }): Promise<unknown> {
    this.assertCapability(actor, 'ontology', 'design');
    const tenantId = actor.tenantId;
    const result = await this.ontologyService.createObjectType(tenantId, {
      name: dto.name,
      label: dto.label,
      description: dto.description,
      properties: dto.properties.map(mapPropertyDto),
      derivedProperties: [],
    });
    this.typeResolver.invalidate(tenantId);
    this.invalidateSchemaSummary(tenantId);
    return result;
  }

  async updateObjectType(actor: CurrentUserType, params: {
    objectTypeName: string;
    label?: string;
    description?: string;
    properties: Array<{ name: string; type: string; label: string; filterable?: boolean; sortable?: boolean; description?: string; unit?: string }>;
  }): Promise<unknown> {
    this.assertCapability(actor, 'ontology', 'design');
    const tenantId = actor.tenantId;
    const typeId = await this.typeResolver.resolve(tenantId, params.objectTypeName);
    return this.ontologyService.updateObjectType(tenantId, typeId, {
      ...(params.label ? { label: params.label } : {}),
      properties: params.properties.map(mapPropertyDto),
    });
  }

  async deleteObjectType(actor: CurrentUserType, objectTypeName: string): Promise<unknown> {
    this.assertCapability(actor, 'ontology', 'design');
    const tenantId = actor.tenantId;
    const typeId = await this.typeResolver.resolve(tenantId, objectTypeName);
    await this.prisma.$transaction(async (tx: any) => {
      await tx.objectInstance.updateMany({
        where: { tenantId, objectType: objectTypeName, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await this.ontologyService.deleteObjectType(tenantId, typeId);
    });
    this.typeResolver.invalidate(tenantId);
    this.invalidateSchemaSummary(tenantId);
    return { message: `对象类型 "${objectTypeName}" 已删除，关联数据已软删除。` };
  }

  async createRelationship(actor: CurrentUserType, params: {
    name: string;
    sourceType: string;
    targetType: string;
    cardinality: string;
  }): Promise<unknown> {
    this.assertCapability(actor, 'ontology', 'design');
    const tenantId = actor.tenantId;
    const ids = await this.typeResolver.resolveMany(tenantId, [params.sourceType, params.targetType]);
    return this.ontologyService.createRelationship(tenantId, {
      name: params.name,
      sourceTypeId: ids.get(params.sourceType)!,
      targetTypeId: ids.get(params.targetType)!,
      cardinality: params.cardinality as any,
    });
  }

  async deleteRelationship(actor: CurrentUserType, params: {
    name: string;
    sourceType: string;
  }): Promise<unknown> {
    this.assertCapability(actor, 'ontology', 'design');
    const tenantId = actor.tenantId;
    const relationships = await this.ontologyService.listRelationships(tenantId);
    const target = relationships.find((r: any) => r.name === params.name && r.sourceType.name === params.sourceType);
    if (!target) throw new Error(`关系 "${params.name}" 不存在`);
    await this.ontologyService.deleteRelationship(tenantId, (target as any).id);
    return { message: `关系 "${params.name}" 已删除。` };
  }

  // --- Connector ---

  async createConnector(tenantId: string, params: {
    name: string;
    type: string;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  }): Promise<{ id: string; name: string; message: string }> {
    const encryptedPassword = this.connectorClient.encrypt(params.password);
    const connector = await this.prisma.connector.create({
      data: {
        tenantId,
        name: params.name,
        type: params.type,
        config: {
          host: params.host,
          port: params.port,
          user: params.user,
          password: encryptedPassword,
          database: params.database,
        } as any,
        status: 'active',
      },
    });
    return { id: connector.id, name: connector.name, message: `连接器"${params.name}"已创建。` };
  }

  async testDbConnection(params: {
    type: string;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  }): Promise<{ success: boolean; message: string }> {
    try {
      const sql = params.type === 'postgresql'
        ? "SELECT count(*) as table_count FROM information_schema.tables WHERE table_schema = 'public'"
        : 'SELECT count(*) as table_count FROM information_schema.tables WHERE table_schema = ?';
      const queryParams = params.type === 'postgresql' ? undefined : [params.database];

      const rows = await this.connectorClient.query(
        { type: params.type, config: { host: params.host, port: params.port, user: params.user, password: params.password, database: params.database } },
        sql,
        queryParams,
      );
      const count = (rows[0] as any).table_count;
      return { success: true, message: `连接成功！发现 ${count} 张表。` };
    } catch (err: any) {
      return { success: false, message: `连接失败: ${err.message}` };
    }
  }

  async listDbTables(tenantId: string, connectorId: string): Promise<{ tables: string[] } | { error: string }> {
    try {
      const connector = await this.connectorClient.getConnection(connectorId, tenantId);
      const sql = connector.type === 'postgresql'
        ? "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
        : 'SELECT table_name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name';
      const params = connector.type === 'postgresql' ? undefined : [connector.config.database];

      const rows = await this.connectorClient.query(connector, sql, params);
      return { tables: rows.map((r: any) => r.table_name || r.TABLE_NAME) };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async previewDbTable(tenantId: string, connectorId: string, tableName: string): Promise<{
    columns: Array<{ name: string; dbType: string }>;
    sampleRows: unknown[];
    totalEstimate: number | null;
  } | { error: string }> {
    try {
      const connector = await this.connectorClient.getConnection(connectorId, tenantId);

      if (connector.type === 'postgresql') {
        const cols = await this.connectorClient.query(
          connector,
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
          [tableName],
        );
        const sampleRows = await this.connectorClient.query(connector, `SELECT * FROM "${tableName}" LIMIT 5`);
        return {
          columns: cols.map((r: any) => ({ name: r.column_name, dbType: r.data_type })),
          sampleRows,
          totalEstimate: null,
        };
      }

      if (connector.type === 'mysql') {
        const cols = await this.connectorClient.query(
          connector,
          'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
          [connector.config.database, tableName],
        );
        const sampleRows = await this.connectorClient.query(connector, `SELECT * FROM \`${tableName}\` LIMIT 5`);
        return {
          columns: cols.map((r: any) => ({ name: r.COLUMN_NAME || r.column_name, dbType: r.DATA_TYPE || r.data_type })),
          sampleRows,
          totalEstimate: null,
        };
      }

      return { error: `不支持的数据库类型: ${connector.type}` };
    } catch (err: any) {
      return { error: `预览失败: ${err.message}` };
    }
  }

  // --- File / Import ---

  async parseFile(fileId: string) {
    const filePath = path.join(UPLOAD_DIR, fileId);
    return this.fileParser.parse(filePath);
  }

  async importData(tenantId: string, params: {
    fileId: string;
    objectType: string;
    externalIdColumn: string;
    labelColumn: string;
  }) {
    return this.importEngine.importFile(tenantId, {
      filePath: path.join(UPLOAD_DIR, params.fileId),
      objectType: params.objectType,
      externalIdColumn: params.externalIdColumn,
      labelColumn: params.labelColumn,
    });
  }
}