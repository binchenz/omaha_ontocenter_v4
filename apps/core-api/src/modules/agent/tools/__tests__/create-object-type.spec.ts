import { CreateObjectTypeTool } from '../create-object-type.tool';
import type { ObjectEdit } from '@omaha/shared-types';

describe('CreateObjectTypeTool (ObjectEdit migration)', () => {
  const mockSdk = {
    createObjectType: jest.fn().mockResolvedValue({ id: 'new-type-id', name: 'widget' }),
  };

  const tool = new CreateObjectTypeTool(mockSdk as any);

  const ctx = {
    user: {
      id: 'u1', email: 'a@b.com', name: 'A', tenantId: 't1',
      roleId: 'r1', roleName: 'admin', permissions: ['*'], permissionRules: [],
    },
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns ObjectEdit[] with op:create', async () => {
    const result = await tool.execute({
      name: 'widget',
      label: '小部件',
      properties: [{ name: 'title', type: 'string', label: '标题' }],
    }, ctx);

    expect(Array.isArray(result)).toBe(true);
    const edits = result as ObjectEdit[];
    expect(edits).toHaveLength(1);
    expect(edits[0].op).toBe('create');
    expect((edits[0] as any).objectType).toBe('widget');
  });

  it('still calls sdk.createObjectType to persist the type definition', async () => {
    await tool.execute({
      name: 'widget',
      label: '小部件',
      properties: [],
    }, ctx);

    expect(mockSdk.createObjectType).toHaveBeenCalledWith('t1', expect.objectContaining({ name: 'widget' }));
  });
});
