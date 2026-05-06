---
status: accepted
---

# Aggregation as a first-class query primitive

`Aggregation` is a sibling concept to `Query Plan`, not a special mode of it. The `aggregate_objects` Tool is independent of `query_objects`. They share the filter/scope/permission compile pipeline inside `QueryPlannerService` but emit different SELECT clauses, return different shapes, and are audited separately.

This was decided in a `/grill-with-docs` session that walked 17 sub-decisions across naming, metric set, groupBy shape, orderBy shape, error semantics, and pagination. Foundry was the reference architecture; deliberate divergences are recorded below.

## What's in v1

- **Metrics**: `count` / `countDistinct` / `sum` / `avg` / `min` / `max`. No `percentile`, no `arrayAgg`, no `topN`-per-group.
- **groupBy**: array of property names. The fields must be `filterable` on the OntologyView. No bucket / time-bucket / range-bucket expressions in v1.
- **orderBy**: array shape on the wire (forward-compat for multi-key); v1 runtime accepts only length ≤ 1 and rejects length > 1 with `MULTI_KEY_SORT_NOT_SUPPORTED`. `kind: 'metric'` orders by alias; `kind: 'groupKey'` orders by groupBy field.
- **Pagination**: `maxGroups` (default 100, hard cap 500, clamp + warn never reject); response carries `truncated` + `nextPageToken` + `totalGroupsEstimate`. `pageToken` is opaque base64-JSON `{ offset }`.
- **Errors**: `METRICS_REQUIRED`, `METRIC_INVALID_FIELD_TYPE`, `PROPERTY_NOT_GROUPABLE`, `UNKNOWN_METRIC_ALIAS`, `MULTI_KEY_SORT_NOT_SUPPORTED`, `STALE_PAGE_TOKEN`. Each carries a `hint` designed for LLM self-correction.
- **Audit**: separate `object.aggregate` operation type; query plan logged; returned numeric values **not** logged (counts/sums can be sensitive). `result_count` field reflects `groups.length`, not metric values.
- **Permissions**: row-level predicates applied **before** aggregation, so an operator can never count rows they cannot read. Field-level masking does not apply (no Object Instance fields are returned).

## What's deliberately out of scope

| Feature | Trigger to revisit |
|---|---|
| Bucket / time-bucket / range-bucket groupBy expressions | A second customer's data forces it. (ADR-0014 / ADR-0015 style: don't generalise on a sample of one.) |
| Multi-key orderBy | A second customer or a stable-ordering requirement forces it. The wire shape already accepts an array. |
| HAVING clause / filter on aggregate result | A real recurring "count books where avg score > 80" workflow appears. |
| Percentile metrics (p50 / p90 etc.) | A real BI-style ask. Different SQL family (`percentile_cont WITHIN GROUP`). |
| `arrayAgg` / `topN` per group | Violates the "Aggregation does not return Object Instance fields" invariant. Currently expressed as `aggregate_objects` followed by `query_objects` per-group. |
| `otherGroup` merged-bucket on truncation | Foundry-style decision: LLM consumers misread `其它` as a real category, eroding trust. We use `truncated` + `nextPageToken` instead. |
| Cross-ObjectType aggregation in one call | Each call targets one Object Type; Agent makes multiple calls. |
| Default order when `orderBy` is omitted | Returned order is undefined; documented in tool description. Encourages the agent to write explicit `orderBy` when ranking matters. |

## Why these specific shapes

- **Aggregation is a separate Tool, not a mode of `query_objects`.** Agent intent ("list rows" vs "summarise") maps cleanly to two tools; cross-shape returns would force every consumer to branch on shape. CONTEXT.md registers `Aggregation` as a domain term distinct from `Query Plan`.
- **`PROPERTY_NOT_GROUPABLE` is not the same code as `PROPERTY_NOT_FILTERABLE`.** Per #38, the Agent didn't fall back well from `PROPERTY_NOT_FILTERABLE`; reusing the same code on the aggregate path would inherit the same bug. New code → distinct hint → distinct fallback strategy ("use search").
- **`alias` is required on every metric.** Same kind can recur (`min(x)` and `min(y)`); aliases anchor return-shape stability and orderBy references.
- **`groupBy` is array even for single-field.** Forward-compat to multi-field with zero breakage.
- **`orderBy` is array even though v1 only allows length ≤ 1.** Same forward-compat reasoning.
- **`maxGroups` clamps rather than rejects.** Agents often request "large maxGroups" to avoid pagination; clamping with a warning is gentler than failing.

## Companion changes

- CONTEXT.md `Aggregation` term added (commit 8632b7c).
- `QuerySkill.systemPrompt` updated to teach the agent when to pick `aggregate_objects` over `query_objects`, and to prefer `gte` for "大于 X" (closes #37 in spirit even though that issue remains open as its own slice).
