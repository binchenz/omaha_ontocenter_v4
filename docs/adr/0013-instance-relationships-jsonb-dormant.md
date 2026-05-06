# `objectInstance.relationships` jsonb is dormant

The `relationships` jsonb column on `object_instances` is declared in the schema and written by the import path, but **no read path in `core-api` currently consults it**. Cross-object queries today either re-issue a separate query keyed on the related object's `external_id`, or rely on the agent stitching results across turns.

This is a gap registry, not a decision: the column is intentional and we expect to read it eventually. Recording the gap so a future engineer doesn't either (a) assume it's load-bearing and design around it, or (b) "clean up an unused column" and break the import contract.

Two natural triggers will move this off "dormant":

1. The QueryService grows a generic "include" mechanism that walks `relationships` jsonb to fetch related instances in one round-trip.
2. A customer's data shape forces the agent into N+1 patterns over relationship hops, and we measure the cost.

Until one of those happens, treat `relationships` as a write-only field whose presence is a forward-compatibility hedge — not as the cross-object query mechanism.

Related: ADR-0012 (relationship reification) — the reified `CharacterRelation` pattern *does* write its endpoints into `relationships`, betting on (1) above. The bet is explicit; if (1) doesn't materialise, the hop in ADR-0012 stays a hop forever, which is still acceptable.
