import { Injectable } from '@nestjs/common';
import { ConnectorClient, ResolvedConnector } from '../agent/connector/connector-client.service';

export interface DbColumn {
  name: string;
  dbType: string;
  nullable: boolean;
}

export interface DbForeignKey {
  /** The table that holds the FK column (the "many" side). */
  sourceTable: string;
  sourceColumn: string;
  /** The referenced table (the "one" side). */
  targetTable: string;
  targetColumn: string;
}

export interface DbUniqueIndex {
  table: string;
  column: string;
}

export interface DbSchemaMetadata {
  tables: string[];
  columnsByTable: Record<string, DbColumn[]>;
  foreignKeys: DbForeignKey[];
  uniqueIndexes: DbUniqueIndex[];
}

/**
 * Reads structural metadata from a client database's information_schema for whole-database
 * reverse-inference (ADR-0032). Extends the existing single-table introspection
 * (CoreSdkService.listDbTables/previewDbTable) with the cross-table reads that turn
 * relationship inference from a guess into a READ: foreign-key constraints, unique indexes,
 * and declared column types. The MySQL-vs-PostgreSQL dialect branch is reused, not rebuilt.
 */
@Injectable()
export class DbIntrospectionService {
  constructor(private readonly connectorClient: ConnectorClient) {}

  /** Read tables + columns(+types) + FK constraints + unique indexes in one pass. */
  async readSchemaMetadata(tenantId: string, connectorId: string): Promise<DbSchemaMetadata> {
    const connector = await this.connectorClient.getConnection(connectorId, tenantId);
    const tables = await this.listTables(connector);
    const columnsByTable: Record<string, DbColumn[]> = {};
    for (const table of tables) {
      columnsByTable[table] = await this.listColumns(connector, table);
    }
    const foreignKeys = await this.listForeignKeys(connector);
    const uniqueIndexes = await this.listUniqueIndexes(connector);
    return { tables, columnsByTable, foreignKeys, uniqueIndexes };
  }

  /** Distinct values of a column (capped), for allowedValues sampling (#74). */
  async sampleDistinctValues(
    tenantId: string,
    connectorId: string,
    table: string,
    column: string,
    cap = 50,
  ): Promise<{ values: string[]; truncated: boolean }> {
    const connector = await this.connectorClient.getConnection(connectorId, tenantId);
    const q = this.quoteIdent(connector.type, table);
    const c = this.quoteIdent(connector.type, column);
    const rows = await this.connectorClient.query(
      connector,
      `SELECT DISTINCT ${c} AS v FROM ${q} WHERE ${c} IS NOT NULL LIMIT ${cap + 1}`,
    );
    const values = rows.map((r: any) => String(r.v ?? r.V)).filter((v) => v !== '');
    const truncated = values.length > cap;
    return { values: truncated ? values.slice(0, cap) : values, truncated };
  }

  private async listTables(connector: ResolvedConnector): Promise<string[]> {
    const sql =
      connector.type === 'postgresql'
        ? "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
        : 'SELECT table_name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name';
    const params = connector.type === 'postgresql' ? undefined : [connector.config.database];
    const rows = await this.connectorClient.query(connector, sql, params);
    return rows.map((r: any) => r.table_name || r.TABLE_NAME);
  }

  private async listColumns(connector: ResolvedConnector, table: string): Promise<DbColumn[]> {
    if (connector.type === 'postgresql') {
      const rows = await this.connectorClient.query(
        connector,
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
        [table],
      );
      return rows.map((r: any) => ({ name: r.column_name, dbType: r.data_type, nullable: r.is_nullable === 'YES' }));
    }
    const rows = await this.connectorClient.query(
      connector,
      'SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
      [connector.config.database, table],
    );
    return rows.map((r: any) => ({
      name: r.COLUMN_NAME || r.column_name,
      dbType: r.DATA_TYPE || r.data_type,
      nullable: (r.IS_NULLABLE || r.is_nullable) === 'YES',
    }));
  }

  /** Foreign-key constraints (the hard basis for one-to-many relationships, ADR-0032). */
  private async listForeignKeys(connector: ResolvedConnector): Promise<DbForeignKey[]> {
    if (connector.type === 'postgresql') {
      const rows = await this.connectorClient.query(
        connector,
        `SELECT
           tc.table_name      AS source_table,
           kcu.column_name    AS source_column,
           ccu.table_name     AS target_table,
           ccu.column_name    AS target_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
      );
      return rows.map((r: any) => ({
        sourceTable: r.source_table,
        sourceColumn: r.source_column,
        targetTable: r.target_table,
        targetColumn: r.target_column,
      }));
    }
    // MySQL: key_column_usage carries referenced_* when the constraint is a FK.
    const rows = await this.connectorClient.query(
      connector,
      `SELECT table_name AS source_table, column_name AS source_column,
              referenced_table_name AS target_table, referenced_column_name AS target_column
       FROM information_schema.key_column_usage
       WHERE table_schema = ? AND referenced_table_name IS NOT NULL`,
      [connector.config.database],
    );
    return rows.map((r: any) => ({
      sourceTable: r.source_table || r.SOURCE_TABLE,
      sourceColumn: r.source_column || r.SOURCE_COLUMN,
      targetTable: r.target_table || r.TARGET_TABLE,
      targetColumn: r.target_column || r.TARGET_COLUMN,
    }));
  }

  /** Single-column UNIQUE indexes (externalId candidates — half-hard, ADR-0032). */
  private async listUniqueIndexes(connector: ResolvedConnector): Promise<DbUniqueIndex[]> {
    if (connector.type === 'postgresql') {
      const rows = await this.connectorClient.query(
        connector,
        `SELECT tc.table_name AS table_name, kcu.column_name AS column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY') AND tc.table_schema = 'public'`,
      );
      return this.dedupeUnique(rows.map((r: any) => ({ table: r.table_name, column: r.column_name })));
    }
    const rows = await this.connectorClient.query(
      connector,
      `SELECT DISTINCT table_name, column_name
       FROM information_schema.statistics
       WHERE table_schema = ? AND non_unique = 0`,
      [connector.config.database],
    );
    return this.dedupeUnique(
      rows.map((r: any) => ({ table: r.table_name || r.TABLE_NAME, column: r.column_name || r.COLUMN_NAME })),
    );
  }

  private dedupeUnique(items: DbUniqueIndex[]): DbUniqueIndex[] {
    const seen = new Set<string>();
    const out: DbUniqueIndex[] = [];
    for (const i of items) {
      const key = `${i.table}::${i.column}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(i);
      }
    }
    return out;
  }


  private quoteIdent(type: string, ident: string): string {
    const safe = ident.replace(/[^A-Za-z0-9_]/g, '');
    return type === 'postgresql' ? `"${safe}"` : `\`${safe}\``;
  }
}
