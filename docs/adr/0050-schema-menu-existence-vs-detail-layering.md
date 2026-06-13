---
status: accepted
---

# Schema awareness for the Agent: existence is never truncated, detail is lazy

## Context

The runtime Agent learns the tenant's Ontology through two paths: an **eager** schema summary injected into every chat system prompt (`OntologySdk.getSchemaSummary`), and a **lazy** `get_ontology_schema` tool it can call mid-turn. Both sat at extremes. The eager path protected the prompt budget by **truncating** — `schema.types.slice(0, 15)`, ordered by `name` ascending, plus only `filterable || sortable` fields. The lazy path had no parameters and returned the **entire** schema or nothing.

This surfaced as a real failure on the `demo` tenant: its 28 object types sort alphabetically with ~22 test-probe types (`agg_probe_*`, `authz_probe_*`, `cap_probe_*`, …) ahead of the four market types (`avc_report`, `brand_share`, `market_metric`, `model_metric`). `slice(0,15)` therefore fed the LLM a menu of pure probe junk — the market ontology, and even `customer`/`product`/`order`, fell below the cut. The Agent could only answer by guessing wrong field names (`period`, `revenue`), then self-healing via a remedial `get_ontology_schema` round-trip. Correct answers, but extra latency and a higher chance of going off-star. (This is **distinct** from the M7 stop-confirm failure of ADR-0049, which is a prompt-instruction-following problem orthogonal to schema awareness — at M7 the Agent demonstrably *did* perceive the ontology.)

The root cause is that two different things were conflated in one summary:

1. **Existence** — *which types exist*. Truncating this is a correctness defect: an Agent that cannot see `market_metric` cannot route to it, and produces invisible wrong answers.
2. **Detail** — *each type's fields, units, enums, relationships*. This is bulky but only needed once a type is chosen.

## Decision

Adopt the load-bearing invariant: **existence is never truncated; only detail is lazy.**

- **Tier 0 — routing menu (always eager, always complete):** every object type appears in the system prompt as one line (`name — description`), **never** sliced. A name + short description is ~15–20 tokens; even 100 types is ~2k tokens and compressible. Truncation moves from "which types exist" (catastrophic) to "which fields, on demand" (safe).
- **Tier 1 — field detail (lazy, per chosen type):** `get_ontology_schema` gains an optional `typeName` parameter so the Agent pulls the full properties of only the type it selected, instead of the all-or-nothing it had.

This dissolves the "which 15 to show" selection problem: Tier 0 makes no selection (all names given), and Tier 1's selection is made implicitly by *which type the Agent queries*.

The invariant only holds if `object_types` is clean, so it is paired with a namespace rule (recorded in `CONTEXT.md` under _Object Type_): **`object_types` is a domain-only namespace.** Test probes and non-domain artifacts must never be written to a real tenant's runtime read path — they belong in throwaway tenants or transaction-rolled-back scopes. Completeness is safe *by construction* rather than by a fragile name-pattern filter at menu-generation time.

## Considered Options

- **Surface-scoped eager (whole ontology incl. fields, narrowed by surface):** simpler, but bets every surface stays type-few and couples the prompt budget to surface config. Rejected as the primary mechanism.
- **Semantic retrieval of top-k relevant types per query:** the eventual answer at thousands of types, but adds an embedding dependency and a new "retrieval missed → type invisible" failure mode. Over-engineered for the current few-dozen-type scale (MEMORY PR #65 deferred dynamic-activation/retrieval — this is where it belongs, later).
- **`kind`/`system` marker column on `ObjectType` + menu filter:** would distinguish system types, but adds a state dimension to the data model and a filter every read site must remember — the same "9+ read points, miss one and you pollute" risk ADR-0031 rejected for shadow-row drafts. Rejected in favor of keeping junk out entirely.
- **Name-convention filter at menu generation (`*_probe_*` skipped):** cheapest, zero migration, but brittle — the next probe prefix leaks, and "what is a domain type" scatters into a regex. Rejected.

## Consequences

- The probe-isolation rule is a **test-infrastructure** obligation, not a schema change: probes must move to throwaway tenants / rolled-back transactions, and the existing `demo`-tenant probe pollution must be cleaned so e2e reproduces against a clean menu.
- **Surface-scoped menus are the identified next layer, deliberately not built now.** Today every tenant is type-few (clean `demo` ≈ 7 types), so the whole-tenant menu fits and does not mislead. A surface→ObjectType map does not yet exist (unlike `SURFACE_SKILLS`, which scopes Skills only, not types), so building it now is premature investment. The design *direction* is two layers (existence-complete menu + surface narrowing); this ADR delivers only the first.
- Until surface narrowing lands, a consume-surface user's menu may still list provenance/design-time types (e.g. `avc_report`, which is "never an Object Type" for business use). Accepted as a focus nicety, not a correctness defect.
