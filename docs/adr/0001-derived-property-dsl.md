# DSL-based Derived Properties at Query Time

Tenant admins declare Derived Properties in the Ontology as DSL expressions, not as code or as materialized columns. The query engine compiles them into SQL at query time. MVP DSL covers comparison, boolean, `exists`/`not exists`, `maxBy`/`minBy`/`first`/`last`, `count`, numeric aggregates (`sum`/`avg`/`min`/`max`), arithmetic, typed parameters, 1-hop field paths, and references to other Derived Properties on the same Object Type. User-defined functions are explicitly out of scope until V2.0.

## Why

Derived Properties are parameterized at call time (e.g. `isPaidAt(cutoffTime)`), which rules out write-time materialization. They must be visualizable in the Query Plan UI (PRD §6.2), statically analyzable by the ontology validator (PRD §7.5), and configurable without code deploys (PRD §10.4) — all of which favor a declarative DSL over sandboxed user code.

Arithmetic + numeric aggregates were included (not just boolean + exists) because real business semantics like "paid in full" need `sum(payments.amount) >= totalAmount`. Cost: NL→Plan generation accuracy drops for arithmetic; the DSL compiler must pin down decimal precision and null propagation rules.

## Consequences

- The DSL compiler is now on the MVP critical path — it must support static dependency analysis (what fields/relations does each Derived Property touch) for validation, permission injection, and Query Plan rendering.
- `null` propagation is fixed: missing values in aggregates coalesce to the type's zero value (`0` for decimal/count/int). Tenants cannot override this. Changing it later is a breaking change to every Derived Property.
- Decimal properties must declare `precision` and `scale` in the Ontology so the compiler can generate correct casts from JSONB text.
- 1-hop path limit is a soft architectural constraint: deeper semantics ("customer's city") must be modeled as a Derived Property, which reinforces Ontology discipline.
- User-defined function support (V2.0) will require a sandbox and a separate execution path — deliberately deferred.
