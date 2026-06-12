import { INestApplication, ForbiddenException } from '@nestjs/common';
import request from 'supertest';
import { OntologySdk } from '../src/modules/ontology/ontology.sdk';
import {
  createTestApp,
  ensureTestTenant,
  cleanupTestTenant,
  loginAsTestTenantAdmin,
  loginAsTestTenantOperator,
  getTestTenantActor,
  TEST_TENANT_ADMIN_EMAIL,
  TEST_TENANT_OPERATOR_EMAIL,
} from './test-helpers';

/**
 * #89 — write authorization at the single service/SDK TCB (ADR-0040 §4). Reads are
 * already gated; this proves write/design-time paths are gated too, for BOTH entry
 * points: the HTTP controller and the Agent tool path. A query-only operator
 * (permissions = object.read/query + action.preview) must be denied; an admin (`*`)
 * must succeed. The Agent must not be a bypass around the gate.
 *
 * Runs against the throwaway `tenant_test` (ADR-0050 namespace rule: probes never
 * touch a real tenant's read path). cleanupTestTenant() removes any types the admin
 * paths create, so nothing leaks across runs.
 */
describe('Write authorization at the single TCB (#89, e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    await ensureTestTenant(app);
    adminToken = await loginAsTestTenantAdmin(app);
    operatorToken = await loginAsTestTenantOperator(app);
  });

  afterAll(async () => {
    await cleanupTestTenant(app);
    await app.close();
  });

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const newType = () => ({
    name: `authz_probe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label: '授权探针',
    properties: [{ name: 'amount', label: '金额', type: 'number', filterable: true }],
  });

  describe('HTTP path (POST /ontology/types)', () => {
    it('denies a query-only operator', async () => {
      await request(app.getHttpServer())
        .post('/ontology/types')
        .set(bearer(operatorToken))
        .send(newType())
        .expect(403);
    });

    it('allows an admin', async () => {
      await request(app.getHttpServer())
        .post('/ontology/types')
        .set(bearer(adminToken))
        .send(newType())
        .expect(201);
    });
  });

  describe('Agent tool path (OntologySdk — the Agent must not be a bypass)', () => {
    let sdk: OntologySdk;

    beforeAll(async () => {
      // OntologySdk injects only OntologyService / TypeResolver / Prisma (no request-scoped
      // PermissionResolver), so it is a plain singleton; resolve() remains safe either way.
      sdk = await app.resolve(OntologySdk);
    });

    it('denies a query-only operator from creating an Object Type via the SDK', async () => {
      const operator = await getTestTenantActor(app, TEST_TENANT_OPERATOR_EMAIL);
      await expect(
        sdk.createObjectType(operator, newType()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an admin to create an Object Type via the SDK', async () => {
      const admin = await getTestTenantActor(app, TEST_TENANT_ADMIN_EMAIL);
      await expect(sdk.createObjectType(admin, newType())).resolves.toBeDefined();
    });
  });
});
