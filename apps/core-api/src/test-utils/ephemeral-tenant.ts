/**
 * Ephemeral tenant harness for test isolation
 *
 * Provides collision-resistant test tenants with guaranteed cleanup,
 * following FK dependency order: DatasetRows → Datasets → ObjectInstances → ObjectTypes → Tenant
 *
 * Usage patterns:
 * 1. beforeEach/afterEach with cleanup tracking
 * 2. withEphemeralTenant HOF for single-test scope
 */

import { PrismaService, Tenant, User } from '@omaha/db';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

/**
 * Result of createEphemeralTenant
 */
export interface EphemeralTenantContext {
  tenant: Tenant;
  adminUser: User;
  ownerRoleId: string;
  operatorRoleId: string;
  viewerRoleId: string;
}

/**
 * Generate collision-resistant tenant slug
 * Format: test-{timestamp}-{random6}
 */
function generateTenantSlug(): string {
  const timestamp = Date.now();
  const random = randomBytes(3).toString('hex'); // 6 hex chars
  return `test-${timestamp}-${random}`;
}

/**
 * Create ephemeral tenant with admin user and basic roles
 *
 * Provisions:
 * - Tenant with collision-resistant slug
 * - Admin user with hashed password
 * - Three roles: owner (all), operator (query+write), viewer (query only)
 *
 * @param prisma PrismaService instance
 * @param overrides Optional tenant/user overrides
 */
export async function createEphemeralTenant(
  prisma: PrismaService,
  overrides?: {
    tenantName?: string;
    adminEmail?: string;
    adminPassword?: string;
  },
): Promise<EphemeralTenantContext> {
  const slug = generateTenantSlug();
  const tenantName = overrides?.tenantName ?? `Test Tenant ${slug}`;
  const adminEmail = overrides?.adminEmail ?? `admin-${slug}@test.local`;
  const adminPassword = overrides?.adminPassword ?? 'test-password-123';

  // Hash password
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // Create tenant
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: tenantName,
      settings: {},
    },
  });

  // Create three standard roles
  const ownerRole = await prisma.role.create({
    data: {
      name: 'owner',
      tenantId: tenant.id,
      permissions: [
        'tenant.admin',
        'object.define',
        'object.read',
        'object.query',
        'object.write',
        'data.import',
        'conversation.create',
      ],
    },
  });

  const operatorRole = await prisma.role.create({
    data: {
      name: 'operator',
      tenantId: tenant.id,
      permissions: [
        'object.read',
        'object.query',
        'object.write',
        'conversation.create',
      ],
    },
  });

  const viewerRole = await prisma.role.create({
    data: {
      name: 'viewer',
      tenantId: tenant.id,
      permissions: ['object.read', 'object.query', 'conversation.create'],
    },
  });

  // Create admin user with owner role
  const adminUser = await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash,
      tenantId: tenant.id,
      name: 'Test Admin',
      roleId: ownerRole.id,
    },
  });

  return {
    tenant,
    adminUser,
    ownerRoleId: ownerRole.id,
    operatorRoleId: operatorRole.id,
    viewerRoleId: viewerRole.id,
  };
}

/**
 * Cleanup ephemeral tenant in FK dependency order
 *
 * Deletion order (child to parent):
 * 1. DatasetRows (FK to Datasets)
 * 2. Datasets (FK to ObjectTypes)
 * 3. ObjectInstances (FK to ObjectTypes)
 * 4. ObjectMappings (FK to ObjectTypes, Datasets)
 * 5. PipelineRuns (FK to Pipelines)
 * 6. Pipelines (FK to ObjectTypes)
 * 7. ObjectTypes (FK to Tenant)
 * 8. AuditLogs (FK to Users via actorId)
 * 9. Users (FK to Tenant, Roles)
 * 10. Roles (FK to Tenant)
 * 11. Conversations (FK to Tenant)
 * 12. Tenant
 *
 * Idempotent: logs missing tenant but doesn't throw
 *
 * @param prisma PrismaService instance
 * @param tenantId Tenant UUID to delete
 */
export async function cleanupTenant(
  prisma: PrismaService,
  tenantId: string,
): Promise<void> {
  // Check tenant exists
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.warn(`[cleanupTenant] Tenant ${tenantId} not found, skipping cleanup`);
    return;
  }

  try {
    // 1. Delete DatasetRows
    const deletedRows = await prisma.datasetRow.deleteMany({
      where: {
        dataset: {
          tenantId,
        },
      },
    });
    console.log(`[cleanupTenant] Deleted ${deletedRows.count} DatasetRows`);

    // 2. Delete Datasets
    const deletedDatasets = await prisma.dataset.deleteMany({
      where: { tenantId },
    });
    console.log(`[cleanupTenant] Deleted ${deletedDatasets.count} Datasets`);

    // 3. Delete ObjectInstances
    const deletedInstances = await prisma.objectInstance.deleteMany({
      where: { tenantId },
    });
    console.log(`[cleanupTenant] Deleted ${deletedInstances.count} ObjectInstances`);

    // 4. Delete ObjectMappings
    const deletedMappings = await prisma.objectMapping.deleteMany({
      where: {
        objectType: {
          tenantId,
        },
      },
    });
    console.log(`[cleanupTenant] Deleted ${deletedMappings.count} ObjectMappings`);

    // 5. Delete PipelineRuns
    const deletedRuns = await prisma.pipelineRun.deleteMany({
      where: {
        pipeline: {
          tenantId,
        },
      },
    });
    console.log(`[cleanupTenant] Deleted ${deletedRuns.count} PipelineRuns`);

    // 6. Delete Pipelines
    const deletedPipelines = await prisma.pipeline.deleteMany({
      where: { tenantId },
    });
    console.log(`[cleanupTenant] Deleted ${deletedPipelines.count} Pipelines`);

    // 7. Delete ObjectTypes
    const deletedTypes = await prisma.objectType.deleteMany({
      where: { tenantId },
    });
    console.log(`[cleanupTenant] Deleted ${deletedTypes.count} ObjectTypes`);

    // 8. Delete AuditLogs (FK to Users via actorId)
    const deletedAuditLogs = await prisma.auditLog.deleteMany({
      where: { tenantId },
    });
    console.log(`[cleanupTenant] Deleted ${deletedAuditLogs.count} AuditLogs`);

    // 9. Delete Users (must delete after AuditLogs, before Roles due to FK)
    const deletedUsers = await prisma.user.deleteMany({
      where: { tenantId },
    });
    console.log(`[cleanupTenant] Deleted ${deletedUsers.count} Users`);

    // 10. Delete Roles
    const deletedRoles = await prisma.role.deleteMany({
      where: { tenantId },
    });
    console.log(`[cleanupTenant] Deleted ${deletedRoles.count} Roles`);

    // 11. Delete Conversations
    const deletedConversations = await prisma.conversation.deleteMany({
      where: { tenantId },
    });
    console.log(`[cleanupTenant] Deleted ${deletedConversations.count} Conversations`);

    // 12. Delete Tenant
    await prisma.tenant.delete({
      where: { id: tenantId },
    });
    console.log(`[cleanupTenant] Deleted Tenant ${tenantId} (${tenant.slug})`);
  } catch (error) {
    console.error(`[cleanupTenant] Error cleaning up tenant ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Higher-order function that guarantees cleanup in finally block
 *
 * Usage:
 * ```ts
 * await withEphemeralTenant(prisma, async (ctx) => {
 *   // Test code using ctx.tenant, ctx.adminUser, etc.
 *   // Cleanup runs even if test throws
 * });
 * ```
 *
 * @param prisma PrismaService instance
 * @param fn Test function receiving EphemeralTenantContext
 * @param overrides Optional tenant/user overrides
 */
export async function withEphemeralTenant<T>(
  prisma: PrismaService,
  fn: (ctx: EphemeralTenantContext) => Promise<T>,
  overrides?: {
    tenantName?: string;
    adminEmail?: string;
    adminPassword?: string;
  },
): Promise<T> {
  const ctx = await createEphemeralTenant(prisma, overrides);

  try {
    return await fn(ctx);
  } finally {
    await cleanupTenant(prisma, ctx.tenant.id);
  }
}
