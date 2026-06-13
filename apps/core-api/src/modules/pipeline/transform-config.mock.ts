/**
 * Shared test double for TransformConfigService.get() (ADR-0054 version-bound lookup).
 *
 * get(tenantId, name, version?) resolves the config matching (tenantId, name); when version is
 * given it must match exactly, otherwise the highest version wins. Throws when nothing matches —
 * a missing (name, version) is a permanent error in the real service. `getCalls` records every
 * (tenantId, name, version) tuple so specs can assert version pinning.
 */
export function makeTransformConfigServiceMock(configs: any[] = []) {
  const getCalls: any[][] = [];
  const get = jest.fn(async (tenantId: string, name: string, version?: number) => {
    getCalls.push([tenantId, name, version]);
    const matches = configs.filter(
      (c) => c.tenantId === tenantId && c.name === name && (version === undefined || c.version === version),
    );
    if (matches.length === 0) {
      throw new Error(`TransformConfig ${name}${version !== undefined ? ` v${version}` : ''} not found`);
    }
    return matches.reduce((a, b) => (b.version > a.version ? b : a));
  });
  // `service` is the object injected into the worker/service under test (typed `any`
  // so it slots into the real constructor param); `getCalls` exposes the recorded call
  // tuples for version-pinning assertions.
  const service: any = { get };
  return { service, get, getCalls } as { service: any; get: jest.Mock; getCalls: any[][] };
}
