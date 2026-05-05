import { ConnectorClient } from '../connector-client.service';

describe('ConnectorClient', () => {
  const mockPrisma: any = {
    connector: {
      findFirst: jest.fn(),
    },
  };

  let client: ConnectorClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ConnectorClient(mockPrisma);
  });

  describe('encrypt/decrypt round-trip', () => {
    it('decrypts what was encrypted', () => {
      const original = 'my-secret-password-123!@#';
      const encrypted = client.encrypt(original);
      const decrypted = client.decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('produces different ciphertext each time (random IV)', () => {
      const text = 'same-password';
      const a = client.encrypt(text);
      const b = client.encrypt(text);
      expect(a).not.toBe(b);
    });
  });

  describe('getConnection', () => {
    it('throws when connector not found', async () => {
      mockPrisma.connector.findFirst.mockResolvedValue(null);
      await expect(client.getConnection('bad-id', 'tenant-1'))
        .rejects.toThrow('连接器不存在');
    });

    it('returns connector config with decrypted password', async () => {
      const encrypted = client.encrypt('secret');
      mockPrisma.connector.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'postgresql',
        config: { host: 'localhost', port: 5432, user: 'admin', password: encrypted, database: 'mydb' },
      });

      const conn = await client.getConnection('conn-1', 'tenant-1');
      expect(conn.type).toBe('postgresql');
      expect(conn.config.password).toBe('secret');
      expect(conn.config.host).toBe('localhost');
    });
  });

  describe('query', () => {
    it('throws for unsupported database type', async () => {
      await expect(client.query({
        type: 'mssql' as any,
        config: { host: 'x', port: 1, user: 'x', password: 'x', database: 'x' },
      }, 'SELECT 1'))
        .rejects.toThrow('不支持的数据库类型: mssql');
    });
  });
});
