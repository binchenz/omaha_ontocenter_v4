/**
 * Integration test for AVC schema fixture
 *
 * Verifies seedMinimalAvcSchema creates production-realistic ObjectTypes
 * matching the production schema from market-metric-importer.service.ts.
 */

import { Test } from '@nestjs/testing';
import { PrismaService } from '@omaha/db';
import { AppModule } from '../../../src/app.module';
import {
  createEphemeralTenant,
  cleanupTenant,
  EphemeralTenantContext,
} from '../../../src/test-utils/ephemeral-tenant';
import { seedMinimalAvcSchema, AvcSchemaRefs } from './avc-schema.fixture';

describe('AVC Schema Fixture', () => {
  let prisma: PrismaService;
  let ctx: EphemeralTenantContext;
  let refs: AvcSchemaRefs;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
  });

  beforeEach(async () => {
    ctx = await createEphemeralTenant(prisma);
    refs = await seedMinimalAvcSchema(prisma, ctx.tenant.id);
  });

  afterEach(async () => {
    await cleanupTenant(prisma, ctx.tenant.id);
  });

  describe('seedMinimalAvcSchema', () => {
    it('should create market_metric ObjectType with correct schema', async () => {
      // Verify ObjectType was created
      const objectType = await prisma.objectType.findUnique({
        where: { id: refs.marketMetricTypeId },
      });

      expect(objectType).toBeDefined();
      expect(objectType!.name).toBe('market_metric');
      expect(objectType!.label).toBe('市场指标');
      expect(objectType!.tenantId).toBe(ctx.tenant.id);

      // Verify properties match production schema
      const properties = objectType!.properties as any[];
      expect(properties).toHaveLength(6);

      const categoryProp = properties.find((p) => p.name === 'category');
      expect(categoryProp).toMatchObject({ name: 'category', type: 'string', filterable: true });

      const monthProp = properties.find((p) => p.name === 'month');
      expect(monthProp).toMatchObject({ name: 'month', type: 'string', filterable: true, sortable: true });

      const yearProp = properties.find((p) => p.name === 'year');
      expect(yearProp).toMatchObject({ name: 'year', type: 'string', filterable: true, sortable: true });

      const metricProp = properties.find((p) => p.name === 'metric');
      expect(metricProp).toMatchObject({
        name: 'metric',
        type: 'string',
        filterable: true,
        allowedValues: ['零售额', '零售量', '零售均价'],
      });

      const valueProp = properties.find((p) => p.name === 'value');
      expect(valueProp).toMatchObject({ name: 'value', type: 'number', sortable: true });

      const sourceReportProp = properties.find((p) => p.name === 'sourceReport');
      expect(sourceReportProp).toMatchObject({ name: 'sourceReport', type: 'string' });

      // Verify dimensions (ADR-0061 §3)
      const dimensions = objectType!.dimensions as any;
      expect(dimensions.required).toEqual(['category', 'month']);
      expect(dimensions.defaults).toEqual({});
      expect(dimensions.requiredEquivalents).toEqual({ month: ['year'] });

      // Verify semantics (ADR-0064 §1: continuous monthly series, DENSE)
      const semantics = objectType!.semantics as any;
      expect(semantics.universe).toBe('whole-market');
      expect(semantics.timeAxis).toEqual({
        field: 'month',
        grain: 'month',
        format: 'YY.MM（26.04=2026年4月）',
        density: 'dense',
      });
    });

    it('should create brand_share ObjectType with correct schema', async () => {
      // Verify ObjectType was created
      const objectType = await prisma.objectType.findUnique({
        where: { id: refs.brandMetricTypeId },
      });

      expect(objectType).toBeDefined();
      expect(objectType!.name).toBe('brand_share');
      expect(objectType!.label).toBe('品牌份额');
      expect(objectType!.tenantId).toBe(ctx.tenant.id);

      // Verify properties match production schema
      const properties = objectType!.properties as any[];
      expect(properties).toHaveLength(7);

      const categoryProp = properties.find((p) => p.name === 'category');
      expect(categoryProp).toMatchObject({ name: 'category', type: 'string', filterable: true });

      const brandProp = properties.find((p) => p.name === 'brand');
      expect(brandProp).toMatchObject({ name: 'brand', type: 'string', filterable: true });

      const priceBandProp = properties.find((p) => p.name === 'priceBand');
      expect(priceBandProp).toMatchObject({ name: 'priceBand', type: 'string', filterable: true });

      const periodProp = properties.find((p) => p.name === 'period');
      expect(periodProp).toMatchObject({ name: 'period', type: 'string', filterable: true });

      const metricProp = properties.find((p) => p.name === 'metric');
      expect(metricProp).toMatchObject({
        name: 'metric',
        type: 'string',
        filterable: true,
        allowedValues: ['share'],
      });

      const valueProp = properties.find((p) => p.name === 'value');
      expect(valueProp).toMatchObject({
        name: 'value',
        type: 'number',
        sortable: true,
        additivity: 'non-additive',
        aggregationWhitelist: { disjointEntities: true },
      });

      const sourceReportProp = properties.find((p) => p.name === 'sourceReport');
      expect(sourceReportProp).toMatchObject({ name: 'sourceReport', type: 'string' });

      // Verify dimensions (ADR-0061 §3: priceBand defaulted + collapsedDefault)
      const dimensions = objectType!.dimensions as any;
      expect(dimensions.required).toEqual(['category', 'period']);
      expect(dimensions.defaults).toEqual({ priceBand: '整体' });
      expect(dimensions.collapsedDefault).toEqual({ priceBand: '整体' });

      // Verify semantics (ADR-0064 §1: SPARSE annual snapshots)
      const semantics = objectType!.semantics as any;
      expect(semantics.universe).toBe('whole-market');
      expect(semantics.timeAxis).toEqual({
        field: 'period',
        grain: 'snapshot',
        format: 'YY.MM',
        density: 'sparse',
      });
    });

    it('should seed zero instances', async () => {
      // Verify no ObjectInstances were created
      const marketMetricInstances = await prisma.objectInstance.count({
        where: {
          tenantId: ctx.tenant.id,
          objectType: 'market_metric',
        },
      });

      const brandShareInstances = await prisma.objectInstance.count({
        where: {
          tenantId: ctx.tenant.id,
          objectType: 'brand_share',
        },
      });

      expect(marketMetricInstances).toBe(0);
      expect(brandShareInstances).toBe(0);
    });

    it('should create valid IDs that can be queried', async () => {
      // Verify the returned IDs are valid UUIDs
      expect(refs.marketMetricTypeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(refs.brandMetricTypeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // Verify both IDs are different
      expect(refs.marketMetricTypeId).not.toBe(refs.brandMetricTypeId);

      // Verify both can be queried back
      const marketType = await prisma.objectType.findUnique({
        where: { id: refs.marketMetricTypeId },
      });
      const brandType = await prisma.objectType.findUnique({
        where: { id: refs.brandMetricTypeId },
      });

      expect(marketType).not.toBeNull();
      expect(brandType).not.toBeNull();
    });
  });
});
