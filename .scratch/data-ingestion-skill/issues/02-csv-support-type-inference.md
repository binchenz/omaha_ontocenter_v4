---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# CSV support + type inference edge cases

## Parent

[Data Ingestion Skill PRD](../PRD.md)

## What to build

Extend `parse_file` tool to handle CSV files. Harden type inference for edge cases common in Chinese SMB data: phone numbers (long digits → string not number), dates in various formats (2024-03-15, 2024/3/15, 20240315), currency strings ("¥75,000" → number), boolean-like values ("是/否", "Y/N").

## Acceptance criteria

- [ ] `POST /files/upload` accepts .csv files in addition to .xlsx
- [ ] CSV parsing handles UTF-8 and GBK encodings (common in Chinese Excel exports)
- [ ] Phone numbers like "13800138001" are inferred as string, not number
- [ ] Dates in formats `YYYY-MM-DD`, `YYYY/M/D`, `YYYYMMDD` are detected as date type
- [ ] Currency strings with ¥ prefix or comma separators are detected as number type
- [ ] "是/否" and "Y/N" columns are detected as boolean type
- [ ] Unit tests cover each edge case

## Blocked by

- [01-tracer-bullet-excel-import](./01-tracer-bullet-excel-import.md)
