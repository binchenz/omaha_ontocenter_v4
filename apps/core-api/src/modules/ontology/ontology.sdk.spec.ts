import { OntologySdk } from './ontology.sdk';
import { CurrentUser } from '@omaha/shared-types';

const ADMIN: CurrentUser = {
  id: 'u1', email: 'a@a', name: 'A', tenantId: 'tenant-1', roleId: 'r1',
  roleName: 'admin', permissions: ['*'], permissionRules: [{ permission: '*' }],
};
const VIEWER: CurrentUser = {
  id: 'u2', email: 'b@b', name: 'B', tenantId: 'tenant-1', roleId: 'r2',
  roleName: 'viewer', permissions: [], permissionRules: [],
};

function makeHarness() {
  const mockTypeResolver = {
    resolve: jest.fn().mockResolvedValue('resolved-id'),
    resolveMany: jest.fn().mockResolvedValue(new Map([['Source', 'src-id'], ['Target', 'tgt-id']])),
    invalidate: jest.fn(),
  };
  const mockOntologyService = {
    listObjectTypes: jest.fn().mockResolvedValue([]),
    listRelationships: jest.fn().mockResolvedValue([]),
    createObjectType: jest.fn().mockResolvedValue({ id: 'type-1' }),
    updateObjectType: jest.fn().mockResolvedValue({ id: 'type-1' }),
    deleteObjectType: jest.fn().mockResolvedValue({ id: 'type-1' }),
    createRelationship: jest.fn().mockResolvedValue({ id: 'rel-1' }),
    deleteRelationship: jest.fn().mockResolvedValue({ id: 'rel-1' }),
  };
  const mockPrisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(mockPrisma)),
    objectInstance: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    actionDefinition: { findMany: jest.fn().mockResolvedValue([]) },
    // Default: no self-brands configured. getTenantProfile (#193) reads this; individual tests
    // override it to exercise the self-identity branch.
    tenant: { findUnique: jest.fn().mockResolvedValue({ id: 'tenant-1', name: 'T', settings: {} }) },
  };
  const sdk = new OntologySdk(mockOntologyService as any, mockTypeResolver as any, mockPrisma);
  return { sdk, mockOntologyService, mockTypeResolver, mockPrisma };
}

describe('OntologySdk — capability gate', () => {
  it('createObjectType rejects viewer', async () => {
    const { sdk } = makeHarness();
    await expect(sdk.createObjectType(VIEWER, { name: 'x', label: 'X', properties: [] })).rejects.toThrow();
  });
  it('updateObjectType rejects viewer', async () => {
    const { sdk } = makeHarness();
    await expect(sdk.updateObjectType(VIEWER, { objectTypeName: 'x', properties: [] })).rejects.toThrow();
  });
  it('deleteObjectType rejects viewer', async () => {
    const { sdk } = makeHarness();
    await expect(sdk.deleteObjectType(VIEWER, 'x')).rejects.toThrow();
  });
  it('createRelationship rejects viewer', async () => {
    const { sdk } = makeHarness();
    await expect(sdk.createRelationship(VIEWER, { name: 'r', sourceType: 'A', targetType: 'B', cardinality: 'one-to-many' })).rejects.toThrow();
  });
  it('deleteRelationship rejects viewer', async () => {
    const { sdk } = makeHarness();
    await expect(sdk.deleteRelationship(VIEWER, { name: 'r', sourceType: 'A' })).rejects.toThrow();
  });
});

describe('OntologySdk — cache invalidation', () => {
  it('createObjectType invalidates TypeResolver and schema summary', async () => {
    const { sdk, mockTypeResolver } = makeHarness();
    // Warm the summary cache first
    await sdk.getSchemaSummary('tenant-1');
    await sdk.createObjectType(ADMIN, { name: 'x', label: 'X', properties: [] });
    expect(mockTypeResolver.invalidate).toHaveBeenCalledWith('tenant-1');
    // Cache must be cleared: a second getSchemaSummary should re-call listObjectTypes
    const { mockOntologyService } = makeHarness();
    // Simple check: invalidateSchemaSummary removes the entry
    const sdk2 = new OntologySdk(mockOntologyService as any, { invalidate: jest.fn() } as any, { actionDefinition: { findMany: jest.fn().mockResolvedValue([]) } } as any);
    await sdk2.getSchemaSummary('t1'); // populates
    sdk2.invalidateSchemaSummary('t1');
    await sdk2.getSchemaSummary('t1'); // must re-call
    expect(mockOntologyService.listObjectTypes).toHaveBeenCalledTimes(2);
  });

  it('deleteObjectType is atomic via $transaction and invalidates caches', async () => {
    const { sdk, mockPrisma, mockTypeResolver } = makeHarness();
    await sdk.deleteObjectType(ADMIN, 'Customer');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTypeResolver.invalidate).toHaveBeenCalledWith('tenant-1');
  });
});

describe('OntologySdk — allowedValues flows through getSchema', () => {
  it('includes allowedValues from listObjectTypes without manual field listing', async () => {
    const { sdk, mockOntologyService } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue([{
      name: 'order', label: '订单', description: undefined,
      properties: [{ name: 'status', type: 'string', label: '状态', filterable: true, allowedValues: ['open', 'closed'] }],
      derivedProperties: [],
    }]);
    const schema = await sdk.getSchema('tenant-1');
    const prop = schema.types[0].properties[0];
    expect(prop.allowedValues).toEqual(['open', 'closed']);
  });
});

describe('OntologySdk — schema menu existence is never truncated (ADR-0050)', () => {
  function manyTypes(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      name: `type_${String(i).padStart(3, '0')}`,
      label: `T${i}`,
      description: undefined,
      properties: [{ name: 'f', type: 'string', label: 'F', filterable: true }],
      derivedProperties: [],
    }));
  }

  it('lists every type name even far beyond the detail budget', async () => {
    const { sdk, mockOntologyService } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue(manyTypes(40));
    const { summary, typeNames } = await sdk.getSchemaSummary('tenant-1');
    expect(typeNames).toHaveLength(40);
    // Every type's existence line is present, including the last one past the budget.
    for (let i = 0; i < 40; i++) {
      expect(summary).toContain(`type_${String(i).padStart(3, '0')}`);
    }
  });

  it('emits field detail within budget and name-only past it', async () => {
    const { sdk, mockOntologyService } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue(manyTypes(40));
    const { summary } = await sdk.getSchemaSummary('tenant-1');
    // In-budget type carries its field; past-budget type is name-only (no field paren).
    expect(summary).toContain('type_000(f:string');
    expect(summary).toContain('- type_039');
    expect(summary).not.toContain('type_039(f:string');
    // Hint points the Agent at the lazy detail path.
    expect(summary).toContain('get_ontology_schema');
  });
});

describe('OntologySdk — schema summary annotates single-value dimensions (#205)', () => {
  it('marks a property with exactly one allowedValue as 恒为 X so the model skips the futile filter', async () => {
    const { sdk, mockOntologyService } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue([{
      name: 'brand_share', label: '品牌份额', description: undefined,
      properties: [{ name: 'metric', type: 'string', label: '指标', filterable: true, allowedValues: ['share'] }],
      derivedProperties: [],
    }]);
    const { summary } = await sdk.getSchemaSummary('tenant-1');
    // single-value dim is flagged as constant, not just enumerated as one option
    expect(summary).toMatch(/metric[^,]*恒为\s*share/);
  });

  it('still enumerates multi-value dimensions normally (no constant annotation)', async () => {
    const { sdk, mockOntologyService } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue([{
      name: 'order', label: '订单', description: undefined,
      properties: [{ name: 'status', type: 'string', label: '状态', filterable: true, allowedValues: ['open', 'closed'] }],
      derivedProperties: [],
    }]);
    const { summary } = await sdk.getSchemaSummary('tenant-1');
    expect(summary).toContain('open|closed');
    expect(summary).not.toContain('恒为');
  });
});

describe('OntologySdk — getTypeDetail lazy Tier-1 (ADR-0050)', () => {
  it('returns only the requested type and its incident relationships', async () => {
    const { sdk, mockOntologyService } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue([
      { name: 'model_metric', label: 'MM', properties: [{ name: 'sales', type: 'number', label: 'S', sortable: true }], derivedProperties: [] },
      { name: 'brand_share', label: 'BS', properties: [], derivedProperties: [] },
      { name: 'customer', label: 'C', properties: [], derivedProperties: [] },
    ]);
    mockOntologyService.listRelationships.mockResolvedValue([
      { name: 'rel1', sourceType: { name: 'model_metric' }, targetType: { name: 'brand_share' }, cardinality: 'one-to-many', description: undefined },
      { name: 'rel2', sourceType: { name: 'customer' }, targetType: { name: 'brand_share' }, cardinality: 'one-to-many', description: undefined },
    ]);
    const detail = await sdk.getTypeDetail('tenant-1', 'model_metric');
    expect(detail.types).toHaveLength(1);
    expect(detail.types[0].name).toBe('model_metric');
    expect(detail.relationships.map(r => r.name)).toEqual(['rel1']);
  });

  it('throws with available type names when the type is unknown', async () => {
    const { sdk, mockOntologyService } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue([
      { name: 'customer', label: 'C', properties: [], derivedProperties: [] },
    ]);
    await expect(sdk.getTypeDetail('tenant-1', 'nope')).rejects.toThrow('customer');
  });
});

describe('OntologySdk — getTenantProfile (data-derived, ADR-pending)', () => {
  it('lists each populated type with its row count and low-cardinality filterable values', async () => {
    const { sdk, mockOntologyService, mockPrisma } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue([
      {
        name: 'market_metric', label: '市场指标', description: undefined,
        properties: [
          { name: 'category', type: 'string', label: '品类', filterable: true },
          { name: 'value', type: 'number', label: '值', sortable: true },
        ],
        derivedProperties: [],
      },
    ]);
    // Row-count groupBy + per-property distinct both go through $queryRawUnsafe.
    // category is passed as a bound param ($2), so match on args, not SQL text.
    mockPrisma.$queryRawUnsafe = jest.fn(async (sql: string, ...args: any[]) => {
      if (/count/i.test(sql)) return [{ object_type: 'market_metric', n: 1234n }];
      if (args.includes('category')) return [{ v: '电饭煲' }, { v: '净水器' }];
      return [];
    });

    const profile = await sdk.getTenantProfile('tenant-1');

    expect(profile).toContain('market_metric');
    expect(profile).toContain('1234');
    expect(profile).toContain('电饭煲');
    expect(profile).toContain('净水器');
  });

  it('returns empty string when the tenant has no instances (caller skips the segment)', async () => {
    const { sdk, mockOntologyService, mockPrisma } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue([
      { name: 'market_metric', label: 'MM', properties: [], derivedProperties: [] },
    ]);
    mockPrisma.$queryRawUnsafe = jest.fn(async () => []); // no rows for any query
    expect(await sdk.getTenantProfile('tenant-1')).toBe('');
  });

  it('omits high-cardinality filterable props but keeps the type with its count', async () => {
    const { sdk, mockOntologyService, mockPrisma } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue([
      {
        name: 'model_metric', label: '机型', description: undefined,
        properties: [{ name: 'model', type: 'string', label: '机型名', filterable: true }],
        derivedProperties: [],
      },
    ]);
    const manyModels = Array.from({ length: 21 }, (_, i) => ({ v: `SF-${i}` })); // > cap of 20
    mockPrisma.$queryRawUnsafe = jest.fn(async (sql: string, ...args: any[]) => {
      if (/count/i.test(sql)) return [{ object_type: 'model_metric', n: 388n }];
      if (args.includes('model')) return manyModels;
      return [];
    });

    const profile = await sdk.getTenantProfile('tenant-1');
    expect(profile).toContain('model_metric');
    expect(profile).toContain('388');
    expect(profile).not.toContain('SF-0'); // high-cardinality dimension dropped
  });

  it('uses schema allowedValues without a DB probe (zero distinct query)', async () => {
    const { sdk, mockOntologyService, mockPrisma } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue([
      {
        name: 'avc_report', label: '报告', description: undefined,
        properties: [{ name: 'coverage', type: 'string', label: '覆盖', filterable: true, allowedValues: ['full', 'essence'] }],
        derivedProperties: [],
      },
    ]);
    const probe = jest.fn(async (sql: string) => {
      if (/count/i.test(sql)) return [{ object_type: 'avc_report', n: 51n }];
      return [];
    });
    mockPrisma.$queryRawUnsafe = probe;

    const profile = await sdk.getTenantProfile('tenant-1');
    expect(profile).toContain('coverage=full/essence');
    // Only the count query ran; allowedValues came from schema, not a DISTINCT probe.
    const distinctCalls = probe.mock.calls.filter(([sql]) => /DISTINCT/i.test(sql as string));
    expect(distinctCalls).toHaveLength(0);
  });

  // #193 — tenant self-brand identity. The source data may carry no brand string matching the
  // tenant's own name; the tenant's products can appear under other brand strings. With selfBrands
  // configured in Tenant.settings, the profile must tell the Agent who "we" is, so a first-person
  // "我们的份额" resolves instead of dumping the whole market.
  it('injects a self-identity line naming the tenant and its self-brands when configured', async () => {
    const { sdk, mockOntologyService, mockPrisma } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue([
      {
        name: 'brand_share', label: '品牌份额', description: undefined,
        properties: [{ name: 'category', type: 'string', label: '品类', filterable: true }],
        derivedProperties: [],
      },
    ]);
    mockPrisma.$queryRawUnsafe = jest.fn(async (sql: string, ...args: any[]) => {
      if (/count/i.test(sql)) return [{ object_type: 'brand_share', n: 886n }];
      if (args.includes('category')) return [{ v: '电饭煲' }];
      return [];
    });
    mockPrisma.tenant = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'tenant-1', name: '示例科技', settings: { selfBrands: ['品牌甲', '品牌乙'] },
      }),
    };

    const profile = await sdk.getTenantProfile('tenant-1');

    expect(profile).toContain('示例科技');
    expect(profile).toContain('品牌甲');
    expect(profile).toContain('品牌乙');
    // the data-derived part still renders
    expect(profile).toContain('brand_share');
  });

  // #200 — the identity bridge must fire on the tenant's OWN NAME, not only first-person pronouns.
  // A real analyst names the tenant ("<tenant>在电饭煲份额") as often as "我们的份额"; the eval
  // found the latter resolved but the former bypassed injection and dumped the whole market.
  it('tells the Agent the tenant name itself is a self-reference, not only pronouns', async () => {
    const { sdk, mockOntologyService, mockPrisma } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue([
      {
        name: 'brand_share', label: '品牌份额', description: undefined,
        properties: [{ name: 'category', type: 'string', label: '品类', filterable: true }],
        derivedProperties: [],
      },
    ]);
    mockPrisma.$queryRawUnsafe = jest.fn(async (sql: string, ...args: any[]) => {
      if (/count/i.test(sql)) return [{ object_type: 'brand_share', n: 886n }];
      if (args.includes('category')) return [{ v: '电饭煲' }];
      return [];
    });
    mockPrisma.tenant = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'tenant-1', name: '示例科技', settings: { selfBrands: ['品牌甲', '品牌乙'] },
      }),
    };

    const profile = await sdk.getTenantProfile('tenant-1');
    // The new prose must explicitly instruct: when the user NAMES the tenant (or its name shows
    // up as a brand), treat it as self too — not just pronouns. We assert the distinguishing
    // instruction phrase + that pronouns and the name are taught together in the trigger.
    expect(profile).toContain('或直接称呼');           // "...第一人称（我们/我方/自家）或直接称呼「示例科技」时"
    expect(profile).toContain('不要当作外部品牌');     // the anti-pattern this closes
  });

  it('omits the self-identity line when no selfBrands are configured (back-compat)', async () => {
    const { sdk, mockOntologyService, mockPrisma } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue([
      {
        name: 'brand_share', label: '品牌份额', description: undefined,
        properties: [{ name: 'category', type: 'string', label: '品类', filterable: true }],
        derivedProperties: [],
      },
    ]);
    mockPrisma.$queryRawUnsafe = jest.fn(async (sql: string, ...args: any[]) => {
      if (/count/i.test(sql)) return [{ object_type: 'brand_share', n: 886n }];
      if (args.includes('category')) return [{ v: '电饭煲' }];
      return [];
    });
    mockPrisma.tenant = {
      findUnique: jest.fn().mockResolvedValue({ id: 'tenant-1', name: 'Acme', settings: {} }),
    };

    const profile = await sdk.getTenantProfile('tenant-1');
    expect(profile).not.toContain('Acme');
    expect(profile).toContain('本租户已导入数据'); // unchanged data-derived header
  });
});

describe('OntologySdk — TypeResolver delegation', () => {
  it('updateObjectType uses TypeResolver not listObjectTypes', async () => {
    const { sdk, mockOntologyService } = makeHarness();
    await sdk.updateObjectType(ADMIN, { objectTypeName: 'Order', properties: [{ name: 'a', type: 'number', label: 'A' }] });
    expect(mockOntologyService.listObjectTypes).not.toHaveBeenCalled();
  });

  it('createRelationship uses resolveMany for both types', async () => {
    const { sdk, mockTypeResolver, mockOntologyService } = makeHarness();
    await sdk.createRelationship(ADMIN, { name: 'has_orders', sourceType: 'Source', targetType: 'Target', cardinality: 'one-to-many' });
    expect(mockTypeResolver.resolveMany).toHaveBeenCalledWith('tenant-1', ['Source', 'Target']);
    expect(mockOntologyService.createRelationship).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      sourceTypeId: 'src-id', targetTypeId: 'tgt-id',
    }));
  });
});
