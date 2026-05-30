---
status: accepted
---

# Ontology template library as a per-OPC private toolbox

## Context

ADR-0030 step 3: reusable ontology templates, so an OPC onboarding a new client of a known kind doesn't re-derive everything. Sequenced last because a template is only worth sinking if validated — the accuracy Evals (ADR-0033) are the objective basis for "is this a good template". Without Evals, a template library is just copy-pasting unvalidated ontologies.

The realistic open-source question is sourcing and maintenance: where do templates come from, who maintains them?

## Decision

**Templates are a per-OPC private toolbox.** An OPC saves their own tuned, Evals-validated ontology (snapshot + question bank) as a private template and instantiates it for the next client of the same kind. This solves the most immediate, simplest need — *same OPC, cross-client reuse* — and deliberately does **not** build community sharing (a template marketplace: quality review, versioning, trust, de-identification at scale — out of scope for the single-pilot stage) nor commit the project to maintaining official built-in templates.

This choice is almost entirely a **convergence of prior decisions**, needing no new mechanism:

- Template storage = the ontology-snapshot format (ADR-0031), stored tenant-independently.
- Template question bank = captured Evals (ADR-0033).
- Applying a template = instantiating the snapshot into a Draft — isomorphic to reverse-inference output (ADR-0032), both "write a draft snapshot" (ADR-0031).
- "Save as template" = copy the current draft/published ontology snapshot + question bank into tenant-independent storage.

The one genuinely new design point is **de-coupling: what a template carries vs strips.**

- **Carries** (reusable business knowledge): object-type structure, fields, relationships, semantic annotations, the Evals question bank, **and allowedValues value sets + externalId column names**. `菜品分类=[热菜,凉菜,主食,汤]` is restaurant-industry common knowledge — exactly the template's value; the OPC can still edit it after applying.
- **Strips** (client privacy, must never cross clients): real data instances (`object_instances`), `tenant_id`, external connector credentials.

So: a template is a **de-identified ontology snapshot + its Evals question bank**. The line is privacy, not structure — value sets and key column names are knowledge, not secrets.

## Considered Options

- **Official built-in templates** — high quality but narrow coverage and commits the project to maintaining many industry templates. Rejected for now.
- **Community template marketplace** — largest ecosystem, but heavy investment (review, versioning, trust, de-identification) beyond the single-pilot stage. Rejected for now.
- **Skeleton-only (strip value sets + key names)** — "purer" but forces the OPC to re-fill the most reusable knowledge after applying. Rejected.

## Consequences

- A de-identification step is required at "save as template" time: drop instances, tenant_id, connector credentials; keep schema + annotations + allowedValues + Evals.
- Applying a template reuses the Draft instantiation path; no separate import mechanism.
- If community sharing is ever added, the de-identification boundary defined here is the precondition — it is the same boundary a marketplace would need, fixed early.
