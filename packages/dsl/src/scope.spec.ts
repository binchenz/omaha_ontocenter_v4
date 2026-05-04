import { emitScope, parentScope, childScope } from './scope';

describe('ObjectInstanceScope', () => {
  it('parent scope emits tenant-scoped FROM with deleted_at filter', () => {
    const scope = parentScope({
      tenantId: '11111111-1111-1111-1111-111111111111',
      objectType: 'order',
    });
    const { sql, params } = emitScope(scope);
    expect(sql).toBe(
      `FROM object_instances WHERE tenant_id = $1::uuid AND object_type = $2 AND deleted_at IS NULL`,
    );
    expect(params).toEqual(['11111111-1111-1111-1111-111111111111', 'order']);
  });

  it('child scope emits correlated subquery predicate tied to parent row', () => {
    const scope = childScope({
      tenantId: '11111111-1111-1111-1111-111111111111',
      objectType: 'payment',
      foreignKey: 'orderId',
      parentAlias: 'object_instances',
    });
    const { sql, params } = emitScope(scope);
    expect(sql).toBe(
      `FROM object_instances child WHERE child.tenant_id = object_instances.tenant_id ` +
        `AND child.object_type = $1 AND child.deleted_at IS NULL ` +
        `AND (child.relationships->>'orderId') = object_instances.id::text`,
    );
    expect(params).toEqual(['payment']);
  });

  it('includeDeleted flag lifts the deleted_at filter', () => {
    const scope = parentScope({
      tenantId: '11111111-1111-1111-1111-111111111111',
      objectType: 'order',
      includeDeleted: true,
    });
    const { sql } = emitScope(scope);
    expect(sql).not.toContain('deleted_at');
  });
});
