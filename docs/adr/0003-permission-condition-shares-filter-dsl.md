# Permission Conditions Share the Query Filter DSL

Row-level permission `condition`s are evaluated by the same DSL/compiler used for user query filters, not by a separate mini-language. A permission rule may reference any property the filter DSL can reference, including Derived Properties. Compiled permission predicates are AND-ed into the main `WHERE` clause alongside user filters. Template variables in conditions are limited to a fixed MVP whitelist: `{{user.id}}`, `{{user.roleId}}`, `{{user.tenantId}}`, `{{now}}`.

## Why

PRD §7.7's permission examples already use filter-shaped conditions, so a separate language would duplicate parsing, validation, and the compiler. Real-world permissions ("customer service only sees orders with negative latest reviews from the last 7 days") inevitably need Derived Properties — segregating those out of permissions would force the model to grow a parallel concept. Performance is comparable because both flavors compile to the same subquery shapes and run as part of one scan.

## Consequences

- Audit logs must persist the `effectivePermissionFilter` — the DSL after template variables have been substituted with the actor's actual values — otherwise logs show `{{user.id}}` and lose forensic value.
- Permission rule authoring needs a static complexity score (cost of subqueries / aggregates the rule introduces). Above a threshold, save is rejected at admin time, not at query time, so a single bad rule can't quietly degrade every query.
- Template variable surface is intentionally tiny; expanding it (e.g. `{{user.region}}`, `{{user.team.id}}`) is a deliberate V1.1 decision so MVP doesn't accidentally couple permissions to a sprawling user profile model.
- Permission compilation depends on the DSL compiler from ADR 0001 — the two are now lockstep. Any change to DSL semantics (null propagation, decimal handling) automatically applies to permissions.
