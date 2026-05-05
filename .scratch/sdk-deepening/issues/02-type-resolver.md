# TypeResolver: extract name→ID resolution with caching

## What to build

Extract the repeated "list all types, scan for name match" pattern into a dedicated `TypeResolver` service. It resolves human-readable Object Type names to database IDs, caches the mapping per tenant, and provides cache invalidation. All SDK methods that currently do inline name resolution will delegate here (wired in slice #4).

## Acceptance criteria

- [ ] New file `agent/sdk/type-resolver.service.ts` with `@Injectable()` decorator
- [ ] `resolve(tenantId, typeName)` returns the type's database ID
- [ ] `resolve()` throws a descriptive error when the type name doesn't exist (message includes the name)
- [ ] `resolveMany(tenantId, typeNames[])` returns a `Map<string, string>` of name→ID
- [ ] Second call with same tenant+name does NOT call `OntologyService.listObjectTypes` again (cached)
- [ ] `invalidate(tenantId?)` clears the cache (next resolve re-fetches)
- [ ] 5 unit tests through public interface: resolve success, unknown throws, cache hit, invalidate, resolveMany

## Blocked by

None - can start immediately
