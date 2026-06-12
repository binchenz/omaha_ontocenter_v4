import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { ConnectorClient } from './connector-client.service';

/**
 * Owns all Connector and DB-introspection operations. Injects ConnectorClient
 * and PrismaService only — no Ontology, no Research concerns.
 */
@Injectable()
export class ConnectorSdk {
  constructor(
    private readonly connectorClient: ConnectorClient,
    private readonly prisma: PrismaService,
  ) {}

  async createConnector(tenantId: string, params: {
    name: string; type: string; host: string; port: number;
    user: string; password: string; database: string;
  }): Promise<{ id: string; name: string; message: string }> {
    const encryptedPassword = await this.connectorClient.encrypt(params.password);
    const connector = await this.prisma.connector.create({
      data: {
        tenantId, name: params.name, type: params.type,
        config: { host: params.host, port: params.port, user: params.user, password: encryptedPassword, database: params.database } as any,
        status: 'active',
      },
    });
    return { id: connector.id, name: connector.name, message: `连接器"${params.name}"已创建。` };
  }

  async testDbConnection(params: {
    type: string; host: string; port: number; user: string; password: string; database: string;
  }): Promise<{ success: boolean; message: string }> {
    try {
      const sql = params.type === 'postgresql'
        ? "SELECT count(*) as table_count FROM information_schema.tables WHERE table_schema = 'public'"
        : 'SELECT count(*) as table_count FROM information_schema.tables WHERE table_schema = ?';
      const queryParams = params.type === 'postgresql' ? undefined : [params.database];
      const rows = await this.connectorClient.query(
        { type: params.type, config: { host: params.host, port: params.port, user: params.user, password: params.password, database: params.database } },
        sql, queryParams,
      );
      return { success: true, message: `连接成功！发现 ${(rows[0] as any).table_count} 张表。` };
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
    columns: Array<{ name: string; dbType: string }>; sampleRows: unknown[]; totalEstimate: number | null;
  } | { error: string }> {
    try {
      const connector = await this.connectorClient.getConnection(connectorId, tenantId);
      if (connector.type === 'postgresql') {
        const cols = await this.connectorClient.query(connector,
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
          [tableName]);
        const sampleRows = await this.connectorClient.query(connector, `SELECT * FROM "${tableName}" LIMIT 5`);
        return { columns: cols.map((r: any) => ({ name: r.column_name, dbType: r.data_type })), sampleRows, totalEstimate: null };
      }
      if (connector.type === 'mysql') {
        const cols = await this.connectorClient.query(connector,
          'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
          [connector.config.database, tableName]);
        const sampleRows = await this.connectorClient.query(connector, `SELECT * FROM \`${tableName}\` LIMIT 5`);
        return { columns: cols.map((r: any) => ({ name: r.COLUMN_NAME || r.column_name, dbType: r.DATA_TYPE || r.data_type })), sampleRows, totalEstimate: null };
      }
      return { error: `不支持的数据库类型: ${connector.type}` };
    } catch (err: any) {
      return { error: `预览失败: ${err.message}` };
    }
  }
}
