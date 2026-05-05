# FileParserService: add `parseAll()` method

## What to build

Add a `parseAll(filePath: string): Promise<Record<string, unknown>[]>` method to `FileParserService` that returns ALL data rows from a file (Excel or CSV), with no 5-row cap. Refactor the existing `parse()` method to call `parseAll()` internally and slice the result to 5 for `sampleRows`. This is the foundation for fixing the import bug where only 5 rows are ever imported.

## Acceptance criteria

- [ ] `parseAll()` returns all rows from a file with more than 5 data rows
- [ ] `parse()` still returns `ParsedFile` with `sampleRows` capped at 5 (no behavior change for `parse_file` tool)
- [ ] `parse()` internally delegates to `parseAll()` — no duplicated row-reading logic
- [ ] Existing file-parser tests continue passing unchanged
- [ ] New test: given a 20-row CSV, `parseAll()` returns exactly 20 records
- [ ] New test: given a 20-row Excel file, `parseAll()` returns exactly 20 records

## Blocked by

None - can start immediately
