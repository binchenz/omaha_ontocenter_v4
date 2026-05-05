import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import * as crypto from 'crypto';

const ENCRYPTION_KEY = process.env.CONNECTOR_ENCRYPTION_KEY ?? 'default-dev-key-32-chars-long!!';

export interface ConnectorConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface ResolvedConnector {
  id: string;
  type: string;
  config: ConnectorConfig;
}

@Injectable()
export class ConnectorClient {
  constructor(private readonly prisma: PrismaService) {}

  encrypt(text: string): string {
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  }

  decrypt(encrypted: string): string {
    const [ivHex, data] = encrypted.split(':');
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  async getConnection(connectorId: string, tenantId: string): Promise<ResolvedConnector> {
    const connector = await this.prisma.connector.findFirst({
      where: { id: connectorId, tenantId },
    });
    if (!connector) throw new Error('连接器不存在');

    const config = connector.config as any;
    return {
      id: connector.id,
      type: connector.type,
      config: {
        host: config.host,
        port: config.port,
        user: config.user,
        password: this.decrypt(config.password),
        database: config.database,
      },
    };
  }

  async query(
    connector: { type: string; config: ConnectorConfig },
    sql: string,
    params?: unknown[],
  ): Promise<any[]> {
    if (connector.type === 'postgresql') {
      const { Client } = await import('pg');
      const client = new Client({
        host: connector.config.host,
        port: connector.config.port,
        user: connector.config.user,
        password: connector.config.password,
        database: connector.config.database,
        connectionTimeoutMillis: 5000,
      });
      await client.connect();
      try {
        const res = await client.query(sql, params);
        return res.rows;
      } finally {
        await client.end();
      }
    }

    if (connector.type === 'mysql') {
      const mysql = await import('mysql2/promise');
      const conn = await mysql.createConnection({
        host: connector.config.host,
        port: connector.config.port,
        user: connector.config.user,
        password: connector.config.password,
        database: connector.config.database,
        connectTimeout: 5000,
      });
      try {
        const [rows] = await conn.query(sql, params);
        return rows as any[];
      } finally {
        await conn.end();
      }
    }

    throw new Error(`不支持的数据库类型: ${connector.type}`);
  }
}
