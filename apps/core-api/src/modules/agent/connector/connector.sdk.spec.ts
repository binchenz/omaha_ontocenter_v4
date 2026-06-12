import { ConnectorSdk } from './connector.sdk';

function makeHarness() {
  const fakePrisma: any = {
    connector: { create: jest.fn().mockResolvedValue({ id: 'c1', name: 'my-db' }) },
  };
  const fakeClient: any = {
    encrypt: jest.fn(async (s: string) => `enc(${s})`),
    query: jest.fn(),
    getConnection: jest.fn(),
  };
  const sdk = new ConnectorSdk(fakeClient, fakePrisma);
  return { sdk, fakePrisma, fakeClient };
}

describe('ConnectorSdk.createConnector', () => {
  it('encrypts the password before persisting', async () => {
    const { sdk, fakePrisma, fakeClient } = makeHarness();
    await sdk.createConnector('t1', { name: 'my-db', type: 'postgresql', host: 'h', port: 5432, user: 'u', password: 'secret', database: 'db' });
    const data = fakePrisma.connector.create.mock.calls[0][0].data;
    expect(fakeClient.encrypt).toHaveBeenCalledWith('secret');
    expect(data.config.password).toBe('enc(secret)');
  });
});

describe('ConnectorSdk.testDbConnection', () => {
  it('returns failure result (not a throw) on connector error', async () => {
    const { sdk, fakeClient } = makeHarness();
    fakeClient.query.mockRejectedValue(new Error('timeout'));
    const result = await sdk.testDbConnection({ type: 'postgresql', host: 'h', port: 5432, user: 'u', password: 'p', database: 'db' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('timeout');
  });

  it('uses parameterized query for mysql (db name as param)', async () => {
    const { sdk, fakeClient } = makeHarness();
    fakeClient.query.mockResolvedValue([{ table_count: 5 }]);
    await sdk.testDbConnection({ type: 'mysql', host: 'h', port: 3306, user: 'u', password: 'p', database: 'mydb' });
    const [, sql, params] = fakeClient.query.mock.calls[0];
    expect(sql).toContain('table_schema = ?');
    expect(params).toEqual(['mydb']);
  });

  it('uses no params for postgresql', async () => {
    const { sdk, fakeClient } = makeHarness();
    fakeClient.query.mockResolvedValue([{ table_count: 3 }]);
    await sdk.testDbConnection({ type: 'postgresql', host: 'h', port: 5432, user: 'u', password: 'p', database: 'db' });
    const [, , params] = fakeClient.query.mock.calls[0];
    expect(params).toBeUndefined();
  });
});

describe('ConnectorSdk.previewDbTable', () => {
  it('postgresql branch: maps column_name / data_type', async () => {
    const { sdk, fakeClient } = makeHarness();
    fakeClient.getConnection.mockResolvedValue({ type: 'postgresql', config: { database: 'db' } });
    fakeClient.query
      .mockResolvedValueOnce([{ column_name: 'id', data_type: 'integer' }])
      .mockResolvedValueOnce([{ id: 1 }]);
    const result = await sdk.previewDbTable('t1', 'c1', 'orders') as any;
    expect(result.columns[0]).toEqual({ name: 'id', dbType: 'integer' });
    expect(result.sampleRows).toHaveLength(1);
  });

  it('mysql branch: maps COLUMN_NAME / DATA_TYPE (case-sensitive fallback)', async () => {
    const { sdk, fakeClient } = makeHarness();
    fakeClient.getConnection.mockResolvedValue({ type: 'mysql', config: { database: 'mydb' } });
    fakeClient.query
      .mockResolvedValueOnce([{ COLUMN_NAME: 'id', DATA_TYPE: 'int' }])
      .mockResolvedValueOnce([{ id: 1 }]);
    const result = await sdk.previewDbTable('t1', 'c1', 'orders') as any;
    expect(result.columns[0]).toEqual({ name: 'id', dbType: 'int' });
  });

  it('returns error object (not a throw) on failure', async () => {
    const { sdk, fakeClient } = makeHarness();
    fakeClient.getConnection.mockRejectedValue(new Error('no connector'));
    const result = await sdk.previewDbTable('t1', 'c1', 'orders') as any;
    expect(result.error).toBeDefined();
  });
});
