---
status: accepted
supersedes-in-part: ADR-0008, ADR-0039
---

# The conversational Agent is a runtime *analysis* Agent; design-time work is scripts, not chat

## Context

ADR-0008 declared the Agent "the product itself" and asserted SMB users would do **all**
operations — data ingestion, ontology design, querying, action execution — through one
conversational loop. ADR-0039 kept that single loop and made the *surface* drive Skill
assembly, justified by **cross-domain continuity** ("import this Excel then query the
A-grade customers in it" must stay one conversation).

Real delivery (AVC / 纯米) and a walk of the live code contradict the premise on which
both ADRs rest:

- **There is exactly one conversational entry point.** `useAgentChat` is used only by
  `chat/page.tsx`, which hardcodes `surface: 'consume'`. The back end accepts any surface,
  but no front-end code ever sends one other than `consume`. The `maintain`/`create`/
  `pipeline` surfaces have **no routes** (`apps/web/lib/surface.tsx`).
- **Design-time ingestion never went through chat.** Real data is loaded by `scripts/`
  (IngestRecipe / `run-recipe.ts`, ADR-0015/0016) calling the services directly. The
  conversational ingestion/modeling Skills (`data_ingestion`, `ontology_design`) and their
  write Tools (`import_data`, `create_object_type`, `execute_action`, …) have **never been
  reached in a real delivery** — neither by a runtime user nor by the OPC.
- **The cross-domain conversation ADR-0039 was built to protect has never occurred** and
  no UI can trigger it: ingestion is a script, querying is `consume`-only chat; they do not
  meet in one conversation.

So the "one omni-capable Agent across all surfaces" abstraction was never exercised. In
practice the runtime Agent had already degenerated into a **consume-only analysis Agent**;
only the documentation still claimed otherwise.

A second, concrete symptom of the same confusion: `render_chart` — the runtime user's most
wanted capability after query/aggregate — was declared by the `research_qa` Skill but
**never registered in `AGENT_TOOLS`**, so the orchestrator's `(registered ∩ declared)` tool
scoping silently dropped it to zero. The chart tool, the SSE `tool_result→chart` wiring, and
the `/chat` chart panel were all built, yet the panel was always blank. The capability lived
in a *design-time-flavoured* Skill (`research_qa` also carries AVC Excel extraction), so the
one thing runtime users actually wanted was both un-wired and mis-filed.

## Decision

**1. Name the runtime Agent for what it is: a read-only analysis Agent.** Its job is the
high-frequency triad observed in real use — **query, aggregate/analyse, chart**. The
`consume` surface loads `query` + `research_qa`; the `query` Skill is now self-sufficient
for the triad (it owns `render_chart`), so a plain analytical turn no longer needs to load
`research_qa`'s heavier research/AVC prose.

**2. Design-time work is scripts + structured UI, not conversation — for now.** We do
**not** invest further in conversational ingestion/modeling. The `data_ingestion` /
`ontology_design` Skills and their write Tools remain in the tree (they are declared,
tested, and the orphan check keeps them honest) but are understood as a **dormant /
unbuilt** path, not a delivered capability. The OPC models and loads data via `scripts/`
against the same services.

**3. The underlying services are NOT dead weight and stay.** `ImportEngine`,
`ApplyService`, `OntologyService`, `ActionExecutor`, the SDK — these back both the query
read-path and the delivery scripts. Only the *conversational shell* over the write
operations is dormant; the services are load-bearing.

**4. A skill→tool reference must be bidirectionally closed, checked at boot.** ADR-0052's
orphan check (`tool → some skill`) is now mirrored by a dangling-ref check
(`skill-declared tool → registered in AGENT_TOOLS`). A Skill that names an unregistered
tool fails fast at `onApplicationBootstrap` instead of shipping a dark, un-callable
capability the way `render_chart` did.

## Considered Options

- **Keep ADR-0008/0039 as written** — rejected: the docs assert a cross-surface omni-Agent
  that the code retired and that misleads the next engineer (who will "fix" the hardcoded
  `consume` thinking it's a bug).
- **Spawn a per-surface Agent now** — rejected: premature; there is still only one surface
  in use. Revisit if/when a real design-time conversational surface is built.
- **Delete the conversational design-time Skills/Tools entirely** — rejected as too
  aggressive: the cost of keeping declared-but-dormant Skills is near-zero (the orphan/
  dangling checks bound the risk), and deleting would force a rebuild if conversational
  modeling is ever wanted. Documenting them as dormant is the cheaper, reversible choice.
- **Solve the chart gap with a runtime intent-classifier** (the system-prompt PRD route) —
  rejected as the *first* move: it patches a structural mis-filing (chart living in a
  research Skill) with a runtime guess. Put the capability in the right Skill first; lazy
  loading is a later, separate question.

## Consequences

- **ADR-0008 scoped:** "the Agent does all operations through conversation" is narrowed to
  "the *runtime* Agent does analysis (query/aggregate/chart) through conversation; design-
  time is scripts." The agent-first thesis survives for runtime; it is explicitly *not* the
  delivery path.
- **ADR-0039 scoped:** surface-driven Skill assembly remains the mechanism, but its
  cross-domain-continuity justification is acknowledged as **unrealised** — only the
  `consume` edge is live. The mechanism is kept (it is what locks chat to `consume` safely)
  without pretending the other surfaces are exercised.
- **`render_chart` is wired** into `AGENT_TOOLS` and owned by the `query` Skill; the chart
  panel now actually renders. `research_qa` keeps its own `render_chart` declaration (the
  union-scoping invariant in its spec requires self-containment).
- **New boot invariant:** `findDanglingToolRefs` runs alongside `findOrphanedTools`; a
  skill/tool mismatch in either direction is a startup error.
- **No schema or HTTP API change.**
