/**
 * Test tenant utilities
 *
 * Extends ephemeral-tenant.ts with schema provisioning helpers
 */

import { PrismaService } from '@omaha/db';
import {
  createEphemeralTenant,
  EphemeralTenantContext,
} from './ephemeral-tenant';

/**
 * Extended context including ObjectType schemas
 */
export interface TestTenantWithSchema extends EphemeralTenantContext {
  objectTypes: {
    id: string;
    name: string;
  }[];
}

/**
 * Schema definition for test object types
 */
export interface ObjectTypeSchema {
  name: string;
  label?: string;
  properties: {
    name: string;
    externalId: string;
    dataType: string;
    isRequired?: boolean;
    isPrimaryKey?: boolean;
  }[];
}

/**
 * Create ephemeral tenant with ObjectType schemas
 *
 * Provisions tenant + admin + roles, then creates ObjectTypes with fields
 *
 * @param prisma PrismaService instance
 * @param schemas Array of ObjectType definitions
 * @param overrides Optional tenant/user overrides
 */
export async function ensureTestTenantWithSchema(
  prisma: PrismaService,
  schemas: ObjectTypeSchema[],
  overrides?: {
    tenantName?: string;
    adminEmail?: string;
    adminPassword?: string;
  },
): Promise<TestTenantWithSchema> {
  // Create base tenant
  const baseCtx = await createEphemeralTenant(prisma, overrides);

  // Create ObjectTypes with properties
  const objectTypes = await Promise.all(
    schemas.map(async (schema) => {
      const objectType = await prisma.objectType.create({
        data: {
          name: schema.name,
          label: schema.label ?? schema.name,
          tenantId: baseCtx.tenant.id,
          properties: schema.properties.map((field) => ({
            name: field.name,
            externalId: field.externalId,
            dataType: field.dataType,
            isRequired: field.isRequired ?? false,
            isPrimaryKey: field.isPrimaryKey ?? false,
          })),
        },
      });

      return {
        id: objectType.id,
        name: objectType.name,
      };
    }),
  );

  return {
    ...baseCtx,
    objectTypes,
  };
}
