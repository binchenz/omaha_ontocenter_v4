import { NotFoundException } from '@nestjs/common';

export function assertTenantOwnership<T extends { tenantId: string }>(
  record: T | null,
  tenantId: string,
  label: string,
): asserts record is T {
  if (!record || record.tenantId !== tenantId) {
    throw new NotFoundException(`${label} not found`);
  }
}
