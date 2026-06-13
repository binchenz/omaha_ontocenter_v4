import { TransformConfigService } from './transform-config.service';

const T = 'tenant-1';

function make(seed: { configs?: any[] } = {}) {
  const configs: any[] = seed.configs ?? [];
  const prisma: any = {
    transformConfig: {
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        let matches = configs.filter(
          (c) =>
            c.tenantId === where.tenantId &&
            (where.name === undefined || c.name === where.name) &&
            (where.version === undefined || c.version === where.version),
        );
        if (orderBy?.version === 'desc') {
          matches = [...matches].sort((a, b) => b.version - a.version);
        }
        return matches[0] ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        configs.filter((c) => c.tenantId === where.tenantId),
      ),
      create: jest.fn(async ({ data }: any) => {
        const c = { id: `tc-${configs.length + 1}`, createdAt: new Date(), ...data };
        configs.push(c);
        return c;
      }),
    },
  };
  return { svc: new TransformConfigService(prisma), configs };
}

describe('TransformConfigService', () => {
  it('creates the first version as version 1', async () => {
    const { svc } = make();
    const c = await svc.create(T, {
      name: 'appliance_brands',
      type: 'brand_mapping',
      config: { mappings: { MIDEA: '美的' } },
    });
    expect(c.version).toBe(1);
  });

  it('appends a new version on same-name create (append-only)', async () => {
    const { svc, configs } = make();
    await svc.create(T, { name: 'appliance_brands', type: 'brand_mapping', config: { mappings: { MIDEA: '美的' } } });
    const v2 = await svc.create(T, {
      name: 'appliance_brands',
      type: 'brand_mapping',
      config: { mappings: { MIDEA: '美的', Haier: '海尔' } },
    });
    expect(v2.version).toBe(2);
    // Both versions retained — nothing mutated in place
    expect(configs).toHaveLength(2);
  });

  it('rejects a brand_mapping config missing the mappings field', async () => {
    const { svc, configs } = make();
    await expect(
      svc.create(T, { name: 'bad', type: 'brand_mapping', config: { foo: 'bar' } }),
    ).rejects.toThrow();
    // Nothing persisted on validation failure
    expect(configs).toHaveLength(0);
  });

  it('accepts a valid price_bands config', async () => {
    const { svc } = make();
    const c = await svc.create(T, {
      name: 'default_bands',
      type: 'price_bands',
      config: { bands: [{ max: 500, label: '0-500' }, { label: '500+' }] },
    });
    expect(c.version).toBe(1);
  });

  it('get returns the latest version when no version is given', async () => {
    const { svc } = make({
      configs: [
        { id: 'a', tenantId: T, name: 'brands', type: 'brand_mapping', version: 1, config: {} },
        { id: 'b', tenantId: T, name: 'brands', type: 'brand_mapping', version: 2, config: {} },
      ],
    });
    const c = await svc.get(T, 'brands');
    expect(c.version).toBe(2);
  });

  it('get returns a specific version when one is given', async () => {
    const { svc } = make({
      configs: [
        { id: 'a', tenantId: T, name: 'brands', type: 'brand_mapping', version: 1, config: {} },
        { id: 'b', tenantId: T, name: 'brands', type: 'brand_mapping', version: 2, config: {} },
      ],
    });
    const c = await svc.get(T, 'brands', 1);
    expect(c.version).toBe(1);
  });

  it('get throws NotFoundException for an unknown config', async () => {
    const { svc } = make();
    await expect(svc.get(T, 'nope')).rejects.toThrow('not found');
  });

  it('list returns only the latest version of each named config', async () => {
    const { svc } = make({
      configs: [
        { id: 'a', tenantId: T, name: 'brands', type: 'brand_mapping', version: 1, config: {} },
        { id: 'b', tenantId: T, name: 'brands', type: 'brand_mapping', version: 2, config: {} },
        { id: 'c', tenantId: T, name: 'bands', type: 'price_bands', version: 1, config: {} },
      ],
    });
    const list = await svc.list(T);
    expect(list).toHaveLength(2);
    const brands = list.find((c) => c.name === 'brands');
    expect(brands?.version).toBe(2);
  });

  it('list enforces tenant isolation', async () => {
    const { svc } = make({
      configs: [{ id: 'a', tenantId: 'other', name: 'brands', type: 'brand_mapping', version: 1, config: {} }],
    });
    const list = await svc.list(T);
    expect(list).toHaveLength(0);
  });
});
