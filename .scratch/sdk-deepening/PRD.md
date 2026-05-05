# PRD: OntologySdk Deepening — TypeResolver + ImportEngine

## Problem Statement

`OntologySdkService` is a 210-line module doing three unrelated jobs poorly:

1. **Name-to-ID resolution is repeated in 5 methods.** Each calls `listObjectTypes(tenantId)`, scans the full array for a name match, and throws if not found. This is O(N) per call with no caching — a conversation that creates a type then imports data into it makes 3+ redundant list calls.

2. **`importData` is broken.** `FileParserService.parse()` always returns at most 5 `sampleRows`. The SDK's "get all rows" branch re-parses the file but still reads `.sampleRows` — so any file with more than 5 data rows silently imports only 5. This is a data-loss bug.

3. **`deleteObjectType` is not atomic.** It soft-deletes instances via `updateMany`, then deletes the type definition in a separate call. If the second step fails, instances are orphaned in a soft-deleted state with their type still existing.

The module is wide (9 public methods) but shallow — most methods are 3-5 line delegations with a name lookup prepended. The real complexity (import pipeline, resolution caching, transactional safety) is either missing or broken.

## Solution

Split `OntologySdkService` into three focused modules:

- **TypeResolver** — owns the "human-readable name → database ID" mapping. Caches per-request or per short TTL. Single method: `resolve(tenantId, typeName) → typeId`. All SDK methods that need an ID delegate here.

- **ImportEngine** — owns the full file-to-database pipeline: parse all rows (not just sample), validate column mapping, batch upsert within a transaction, report progress. Fixes the 5-row bug by design.

- **OntologySdk (slimmed)** — retains the facade role but delegates resolution to TypeResolver and import to ImportEngine. Methods shrink to 2-3 lines each.

## User Stories

1. As a user importing a 500-row Excel file, I want all 500 rows to appear in the system, so that my data is complete.
2. As a user importing data, I want the import to either fully succeed or fully fail, so that I never end up with partial data.
3. As a user deleting an object type, I want the deletion to be atomic, so that I don't end up with orphaned soft-deleted instances if something goes wrong.
4. As a user in a multi-step conversation (create type → import → query), I want the agent to respond quickly without redundant API calls, so that the experience feels snappy.
5. As a developer adding a new SDK method that references an object type by name, I want a single utility to resolve the name, so that I don't copy-paste the list-and-scan pattern.
6. As a developer writing tests for the import pipeline, I want to test import logic independently of the full SDK, so that tests are fast and focused.
7. As a developer writing tests for name resolution, I want to verify caching and error behavior through a small interface, so that edge cases (type not found, stale cache) are covered.
8. As a user importing a file with duplicate externalId values, I want the system to upsert (last-write-wins), so that re-imports are idempotent.
9. As a user importing a large file (10k+ rows), I want the import to batch writes efficiently, so that it completes in reasonable time without overwhelming the database.
10. As a developer, I want `UPLOAD_DIR` defined in one place, so that file path logic doesn't drift across modules.

## Implementation Decisions

### Modules to build/modify

**New: `TypeResolver`**
- Injectable NestJS service in `agent/sdk/type-resolver.service.ts`
- Interface: `resolve(tenantId: string, typeName: string): Promise<string>` (returns type ID, throws if not found)
- Internally calls `OntologyService.listObjectTypes` once per tenant per resolution batch, caches the name→ID map for the lifetime of the service instance (acceptable because type creation/deletion within a single agent run is rare, and the resolver is request-scoped or has a short TTL)
- Also exposes `resolveMany(tenantId: string, typeNames: string[]): Promise<Map<string, string>>` for batch lookups (used by `createRelationship` which needs source + target)

**New: `ImportEngine`**
- Injectable NestJS service in `agent/sdk/import-engine.service.ts`
- Interface: `importFile(tenantId: string, params: ImportParams): Promise<ImportResult>`
- `ImportParams`: `{ fileId, objectType, externalIdColumn, labelColumn, columnMapping?: Record<string, string> }`
- `ImportResult`: `{ imported: number, skipped: number, objectType: string }`
- Internally: calls `FileParserService.parseAll(filePath)` (new method, see below) to get all rows, then batch-upserts in chunks of 500 within a Prisma transaction
- Owns the `UPLOAD_DIR` constant (single source of truth)

**Modified: `FileParserService`**
- Add `parseAll(filePath: string): Promise<Record<string, unknown>[]>` — returns all data rows (no 5-row cap)
- Existing `parse()` remains unchanged (returns `ParsedFile` with `sampleRows` for the `parse_file` tool's preview use case)
- Internally, `parse()` calls `parseAll()` and slices to 5 — DRY

**Modified: `OntologySdkService`**
- Remove `importData` method entirely (delegated to ImportEngine)
- Replace inline name-resolution logic in `updateObjectType`, `deleteObjectType`, `createRelationship`, `deleteRelationship` with `TypeResolver.resolve()` calls
- `deleteObjectType` wraps both steps in `prisma.$transaction()`
- Remove `FileParserService` dependency (no longer needed here)
- Remove `UPLOAD_DIR` constant (moved to ImportEngine)

**Modified: `ImportDataTool`**
- Change dependency from `OntologySdkService` to `ImportEngine`

**Modified: `ParseFileTool`**
- Import `UPLOAD_DIR` from ImportEngine (or a shared constants file) instead of defining its own

### Architectural decisions

- **TypeResolver caching strategy:** Simple in-memory Map, invalidated on any write operation (create/update/delete type) within the same service instance. No Redis or external cache — the agent module is single-process and conversations are short-lived.
- **ImportEngine transaction boundary:** The entire batch-upsert loop runs inside `prisma.$transaction()`. If any row fails validation or upsert, the entire import rolls back. This matches user story #2.
- **Batch size:** 500 rows per `createMany`/upsert batch. Prisma's `$transaction` with sequential operations. Not `createMany` (which doesn't support upsert) — use a loop of `upsert` calls within the transaction, same as today but wrapped.
- **deleteObjectType atomicity:** Wrap `updateMany` (soft-delete instances) + `ontologyService.deleteObjectType` in `prisma.$transaction()` using the interactive transaction API.
- **UPLOAD_DIR single source:** Defined as an exported constant in `import-engine.service.ts`. `ParseFileTool` and `FileController` import from there.

## Testing Decisions

Good tests verify behavior through public interfaces, not implementation details. The code can change entirely; tests shouldn't break unless behavior changes.

### Modules to test

**TypeResolver** (new tests):
- Resolves a known type name to its ID
- Throws descriptive error for unknown type name
- Caches: second call with same tenant+name does not hit OntologyService again
- Cache invalidation: after `invalidate()`, next call re-fetches
- `resolveMany` returns a Map with all requested names

**ImportEngine** (new tests):
- Imports all rows from a file (not just 5) — the critical regression test
- Upserts on duplicate externalId (idempotent re-import)
- Rolls back entirely on mid-batch failure (transaction atomicity)
- Handles empty file gracefully (0 rows imported, no error)
- Respects column mapping when provided

**OntologySdkService** (new tests for modified behavior):
- `deleteObjectType` is atomic (mock Prisma transaction, verify both operations are inside it)
- Methods delegate to TypeResolver (verify resolve is called, not listObjectTypes directly)

### Prior art

- `apps/core-api/src/modules/agent/tools/__tests__/file-parser.spec.ts` — creates real temp files and tests parsing. ImportEngine tests should follow the same pattern (real files, mock Prisma).
- `apps/core-api/src/modules/agent/agent.service.spec.ts` — mocks LLM and tools via interface. TypeResolver tests should mock OntologyService the same way.

## Out of Scope

- **Streaming/chunked file parsing for very large files (100MB+).** Current approach loads the full file into memory. This is acceptable for the 50MB upload limit. Streaming can be added later if the limit increases.
- **Progress reporting during import.** The ImportEngine returns a final result, not a stream of progress events. Real-time progress (e.g., "imported 200/500 rows") is a future enhancement.
- **ConnectorClient extraction** (candidate #1 from the architecture review). That's a separate PRD.
- **Confirmation flow fix** (candidate #4). Separate PRD.
- **Tool scoping enforcement** (candidate #3). Separate PRD.
- **History reconstruction** (candidate #5). Separate PRD.

## Further Notes

- The 5-row import bug is a silent data-loss issue. Any user who has imported data via the agent has at most 5 rows per object type. After this fix, re-importing the same file will upsert all rows correctly (idempotent by externalId).
- `DeleteObjectTypeTool` currently injects `PrismaService` but never uses it (the SDK does the work). After this refactor, that dead injection should be removed.
- The `CONNECTOR_ENCRYPTION_KEY` duplication across 3 tool files is noted but out of scope — it belongs to the ConnectorClient extraction PRD.
