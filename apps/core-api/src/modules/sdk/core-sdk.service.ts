import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { OntologyService } from '../ontology/ontology.service';
import { QueryService } from '../query/query.service';
import { PrismaService } from '@omaha/db';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';
import { TypeResolver } from '../agent/sdk/type-resolver.service';
import { ConnectorClient } from '../agent/connector/connector-client.service';
import { ImportEngine, UPLOAD_DIR } from '../agent/sdk/import-engine.service';
import { FileParserService } from '../agent/tools/file-parser.service';

export interface OntologySchema {
  types: Array<{
    name: string;
    label: string;
    properties: Array<{ name: string; type: string; label: string; filterable?: boolean; sortable?: boolean }>;
    derivedProperties: Array<{ name: string; type: string; label: string }>;
  }>;
  relationships: Array<{
    name: string;
    sourceType: string;
    targetType: string;
    cardinality: string;
  }>;
}

type PropertyType = 'string' | 'number' | 'boolean' | 'date' | 'json';

function mapPropertyDto(p: { name: string; type: string; label: string; filterable?: boolean; sortable?: boolean }) {
  return {
    name: p.name,
    type: p.type as PropertyType,
    label: p.label,
    filterable: p.filterable,
    sortable: p.sortable,
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
        properties: (t.properties ?? []).map((p: any) => ({
          name: p.name, type: p.type, label: p.label, filterable: p.filterable, sortable: p.sortable,
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
      })),
    };
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

  async createObjectType(tenantId: string, dto: {
    name: string;
    label: string;
    properties: Array<{ name: string; type: string; label: string; filterable?: boolean; sortable?: boolean }>;
  }): Promise<unknown> {
    const result = await this.ontologyService.createObjectType(tenantId, {
      name: dto.name,
      label: dto.label,
      properties: dto.properties.map(mapPropertyDto),
      derivedProperties: [],
    });
    this.typeResolver.invalidate(tenantId);
    return result;
  }

  async updateObjectType(tenantId: string, params: {
    objectTypeName: string;
    label?: string;
    properties: Array<{ name: string; type: string; label: string; filterable?: boolean; sortable?: boolean }>;
  }): Promise<unknown> {
    const typeId = await this.typeResolver.resolve(tenantId, params.objectTypeName);
    return this.ontologyService.updateObjectType(tenantId, typeId, {
      ...(params.label ? { label: params.label } : {}),
      properties: params.properties.map(mapPropertyDto),
    });
  }

  async deleteObjectType(tenantId: string, objectTypeName: string): Promise<unknown> {
    const typeId = await this.typeResolver.resolve(tenantId, objectTypeName);
    await this.prisma.$transaction(async (tx: any) => {
      await tx.objectInstance.updateMany({
        where: { tenantId, objectType: objectTypeName, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await this.ontologyService.deleteObjectType(tenantId, typeId);
    });
    this.typeResolver.invalidate(tenantId);
    return { message: `对象类型 "${objectTypeName}" 已删除，关联数据已软删除。` };
  }

  async createRelationship(tenantId: string, params: {
    name: string;
    sourceType: string;
    targetType: string;
    cardinality: string;
  }): Promise<unknown> {
    const ids = await this.typeResolver.resolveMany(tenantId, [params.sourceType, params.targetType]);
    return this.ontologyService.createRelationship(tenantId, {
      name: params.name,
      sourceTypeId: ids.get(params.sourceType)!,
      targetTypeId: ids.get(params.targetType)!,
      cardinality: params.cardinality as any,
    });
  }

  async deleteRelationship(tenantId: string, params: {
    name: string;
    sourceType: string;
  }): Promise<unknown> {
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