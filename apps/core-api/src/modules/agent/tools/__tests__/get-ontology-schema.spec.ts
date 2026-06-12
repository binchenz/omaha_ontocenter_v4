import { GetOntologySchemaTool } from '../get-ontology-schema.tool';

describe('GetOntologySchemaTool — Tier-1 lazy routing (ADR-0050)', () => {
  const mockSdk = {
    getSchema: jest.fn().mockResolvedValue({ types: [], relationships: [] }),
    getTypeDetail: jest.fn().mockResolvedValue({ types: [{ name: 'model_metric' }], relationships: [] }),
  };
  const tool = new GetOntologySchemaTool(mockSdk as any);
  const ctx = {
    user: {
      id: 'u1', email: 'a@b.com', name: 'A', tenantId: 't1',
      roleId: 'r1', roleName: 'admin', permissions: ['*'], permissionRules: [],
    },
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('returns the full schema when no typeName is given', async () => {
    await tool.execute({}, ctx);
    expect(mockSdk.getSchema).toHaveBeenCalledWith('t1');
    expect(mockSdk.getTypeDetail).not.toHaveBeenCalled();
  });

  it('routes to getTypeDetail when typeName is given', async () => {
    await tool.execute({ typeName: 'model_metric' }, ctx);
    expect(mockSdk.getTypeDetail).toHaveBeenCalledWith('t1', 'model_metric');
    expect(mockSdk.getSchema).not.toHaveBeenCalled();
  });

  it('trims whitespace and ignores a blank typeName', async () => {
    await tool.execute({ typeName: '   ' }, ctx);
    expect(mockSdk.getSchema).toHaveBeenCalledWith('t1');
    expect(mockSdk.getTypeDetail).not.toHaveBeenCalled();
  });
});
