# ImportEngine: full-file batch upsert in transaction

## What to build

A new `ImportEngine` service that owns the complete file-to-database import pipeline. It uses `FileParserService.parseAll()` to read all rows, `TypeResolver.resolve()` to validate the target Object Type exists, and `prisma.$transaction()` to batch-upsert all rows atomically. This fixes the critical bug where `importData` only ever imports 5 rows. `ImportDataTool` switches its dependency from `OntologySdkService` to `ImportEngine`.

## Acceptance criteria

- [ ] New file `agent/sdk/import-engine.service.ts` with `@Injectable()` decorator
- [ ] `importFile(tenantId, params)` imports ALL rows from the file (not just 5)
- [ ] Upserts are batched (500 per chunk) within a single Prisma interactive transaction
- [ ] If any row fails mid-batch, the entire import rolls back (no partial data)
- [ ] Duplicate `externalId` values are handled via upsert (last-write-wins, idempotent)
- [ ] Empty file returns `{ imported: 0, skipped: 0 }` without error
- [ ] `UPLOAD_DIR` is defined and exported from this file (single source of truth)
- [ ] `ImportDataTool` depends on `ImportEngine` instead of `OntologySdkService`
- [ ] Test: 20-row file → 20 rows in DB
- [ ] Test: re-import same file → still 20 rows (upsert, not duplicate)
- [ ] Test: simulated mid-batch failure → 0 rows persisted
- [ ] Test: empty file → success with 0 imported
- [ ] Test: file with column mapping applied correctly

## Blocked by

- Slice #1 (FileParserService `parseAll()`)
- Slice #2 (TypeResolver)
