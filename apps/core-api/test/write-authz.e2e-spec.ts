import { INestApplication, ForbiddenException } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '@omaha/db';
import { OntologySdk } from '../src/modules/ontology/ontology.sdk';
import { CurrentUser } from '@omaha/shared-types';
import {
  createTestApp,
  loginAsAdmin,
  loginAsOperator,
} from './test-helpers';

/**
 * #89 — write authorization at the single service/SDK TCB (ADR-0040 §4). Reads are
 * already gated; this proves write/design-time paths are gated too, for BOTH entry
 * points: the HTTP controller and the Agent tool path. A query-only operator
 * (permissions = object.read/query + action.preview) must be denied; an admin (`*`)
 * must succeed. The Agent must not be a bypass around the gate.
 */
describe('Write authorization at the single TCB (#89, e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = await loginAsAdmin(app);
    operatorToken = await loginAsOperator(app);
  });

  afterAll(async () => {
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
    let prisma: PrismaService;

    const actorFor = async (email: string): Promise<CurrentUser> => {
      const u = await prisma.user.findFirst({
        where: { email },
        include: { role: true },
      });
      const perms = (u!.role.permissions as unknown as string[]) ?? [];
      return {
        id: u!.id,
        email: u!.email,
        name: u!.name,
        tenantId: u!.tenantId,
        roleId: u!.roleId,
        roleName: u!.role.name,
        permissions: perms,
        permissionRules: perms.map((p) => ({ permission: p })),
      };
    };

    beforeAll(async () => {
      // OntologySdk injects only OntologyService / TypeResolver / Prisma (no request-scoped
      // PermissionResolver), so it is a plain singleton; resolve() remains safe either way.
      sdk = await app.resolve(OntologySdk);
      prisma = app.get(PrismaService);
    });

    it('denies a query-only operator from creating an Object Type via the SDK', async () => {
      const operator = await actorFor('ops@demo.com');
      await expect(
        sdk.createObjectType(operator, newType()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an admin to create an Object Type via the SDK', async () => {
      const admin = await actorFor('admin@demo.com');
      await expect(sdk.createObjectType(admin, newType())).resolves.toBeDefined();
    });
  });
});
