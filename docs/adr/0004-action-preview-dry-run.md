# Action Preview is a Dry-Run that Produces an ActionPlan

> **Status: Draft — not yet implemented.** Schema tables (`ActionDefinition`, `ActionPreview`, `ActionRun`) exist but no module or service code has been written. This ADR records the design intent for when Action support is built.

Every Action handler returns a structured `ActionPlan` describing intended writes and external calls; it never commits directly. **Preview** invokes the handler, persists the plan, validates permissions/preconditions, and returns a `previewId` plus a hash of the plan. **Execute** accepts the `previewId`, recomputes the hash, re-checks permissions, then hands the frozen plan to a commit engine that performs the writes inside a transaction. MVP supports db-only plans; external (non-revocable) API calls are deferred to V1.1. The PRD-stated lifecycle `Discover → Validate → Authorize → Preview → Confirm → Execute → Audit` maps onto this split, with Validate / Authorize / Precondition checks running inside Preview (and re-run partially at Execute).

## Why

PRD §6.4 requires the user to see exactly what will happen before confirming ("生成任务预览 → 用户确认 → 创建任务"); a free-text description cannot guarantee "what you saw is what got done." Dry-run + structured plan gives LLM agents a machine-readable artifact to show the user and audit. A hash-bound token closes the race where the underlying data or the actor's inputs change between preview and confirm — mismatch forces re-preview, which aligns with "high-risk actions must be re-confirmed."

## Consequences

- **Handler contract is strict**: handlers are pure functions `(input, context) → ActionPlan`. Direct `prisma.create` inside a handler is a code-review fail; a lint rule should enforce this.
- **ActionPlan shape** (MVP): `{ writes: [{ objectType, op: 'create'|'update'|'delete', data }], externalCalls: [] }`. `externalCalls` exists in the type but rejects any value in MVP.
- **Two persistence points**: `ActionPreview` (plan + hash + createdBy + expiresAt) and `ActionRun` (execution result + diffs). Audit writes both — "what was promised" and "what was done" are separately inspectable.
- **Token expiry**: previews expire (suggested 5 min default, tenant-configurable). Expired preview = force re-preview. Not a security boundary by itself — the hash is — but limits stale-data confusion.
- **Execute re-checks permissions** (because role assignments can change mid-session) but does **not** re-run preconditions or re-compute the plan. If preconditions changed, the hash still matches the snapshot the user confirmed; this is intentional — the user confirmed that snapshot.
- **V1.1 external API door**: `externalCalls` entries will gain a `revocable: boolean` flag. Non-revocable calls run last in commit order; if any prior write fails, the call never executes. Revocable calls run inside the transaction with compensating calls on rollback. Designing the plan shape this way now avoids a breaking change later.
- **DSL coupling**: preconditions reference the filter DSL (ADR 0001, 0003), so preview evaluation already goes through the same compiler as queries — one code path for "does this object satisfy this predicate."
