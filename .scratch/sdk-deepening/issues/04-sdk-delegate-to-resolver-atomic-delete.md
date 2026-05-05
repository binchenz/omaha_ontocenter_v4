# OntologySdk: delegate to TypeResolver + atomic delete

## What to build

Slim down `OntologySdkService` by replacing all inline name-resolution logic with `TypeResolver.resolve()` calls, removing the `importData` method (now owned by ImportEngine), and wrapping `deleteObjectType` in a Prisma interactive transaction so that instance soft-deletion and type deletion are atomic.

## Acceptance criteria

- [ ] `updateObjectType` uses `TypeResolver.resolve()` instead of `listObjectTypes` + scan
- [ ] `deleteObjectType` uses `TypeResolver.resolve()` instead of `listObjectTypes` + scan
- [ ] `deleteObjectType` wraps soft-delete + type deletion in `prisma.$transaction()`
- [ ] `createRelationship` uses `TypeResolver.resolveMany()` for source + target
- [ ] `deleteRelationship` no longer calls `listObjectTypes` (uses relationship list only, which is correct)
- [ ] `importData` method is removed from `OntologySdkService`
- [ ] `FileParserService` dependency is removed from `OntologySdkService`
- [ ] `UPLOAD_DIR` constant is removed from this file
- [ ] Test: `deleteObjectType` — if type deletion throws, instances are NOT soft-deleted (transaction rolled back)
- [ ] Test: methods call `TypeResolver.resolve()` (mock verifies no direct `listObjectTypes` call)

## Blocked by

- Slice #2 (TypeResolver)
