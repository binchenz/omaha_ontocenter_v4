---
status: needs-triage
type: AFK
created: 2026-05-04
---

# 09 - Permission conditions via DSL + template whitelist + audit

## Parent

`.scratch/derived-property-engine/PRD.md`

## What to build

Replace the structured `condition` shape in `Role.permissions` with a DSL source string; compile it through the same `@omaha/dsl` pipeline used for user filters (per ADR-0003). Template variables are a fixed whitelist — `{{user.id}}`, `{{user.roleId}}`, `{{user.tenantId}}`, `{{now}}` — substituted at compile time; anything outside the whitelist is a save-time error. The planner AND-s permission predicates into the base `WHERE` alongside user filters. Reject save of any permission rule whose complexity score exceeds a fixed threshold. Extend audit logs with `effective_permission_filter` (JSONB) and `compiled_sql_hash` (text); populate both on every query execution.

Existing structured `condition` rules, if any, are migrated by the same save path being exercised — the public representation becomes DSL-only after this slice.

## Acceptance criteria

- [ ] `Role.permissions` accepts `condition: string` (DSL) and the planner compiles it per request
- [ ] Template variables are substituted before compilation; unknown templates produce a save-time error
- [ ] Permission-rule save rejects when static complexity > threshold, citing the rule and the score
- [ ] Every `/query/objects` execution writes an `audit_logs` row with `effective_permission_filter` (post-substitution) and `compiled_sql_hash`
- [ ] E2E: a `sales` user's query on Orders sees only rows where `salesOwnerId = {{user.id}}`, even when the user omits that filter
- [ ] E2E: a `customer_service` permission referencing a derived property (`latestReviewIsPositive = false`) scopes the query correctly
- [ ] Audit E2E asserts the substituted filter contains the actor's actual id, not the template

## Blocked by

- Issue 03 (DSL v1 skeleton)
