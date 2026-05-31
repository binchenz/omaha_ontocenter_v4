---
status: accepted
superseded-in-part-by: ADR-0038
---

# Split the product into an OPC design-time workbench and an SMB runtime Agent

> **Partially superseded by ADR-0038.** The design-time/runtime *concept* (distinct interaction models and security boundaries) stands. The *audience binding* below — "two disjoint faces bound to two disjoint audiences" (OPC=design-time, SMB=runtime-only) — does **not**: ADR-0038 decouples surface (← task) from authorization (← role), so an SMB developer may be authorized for design-time tasks. Read this ADR for the concept; read ADR-0038 for who-sees-what.

## Context

The platform is not sold to enterprises as a finished product. The intended go-to-market is an **OPC** (one-person company, typically a data analyst) who privately deploys it for an SMB client, interviews the client, models the business into an Ontology, loads data, tunes query accuracy, and hands off a working querying Agent. (Vision restated by the project owner; the platform deliberately does **not** close a commercial loop itself.)

The current implementation exposes a single `/chat` Agent carrying all three skills (ontology-design, data-ingestion, query) plus a read-only `/ontology` browser and a stub `/query` page that just redirects to `/chat`. So in practice the OPC's **design-time** modeling work and the SMB end users' **runtime** querying both happen in one chat with one skill set.

This is the structural root of the two problems the owner raised: "功能不清晰" (unclear functionality) and "对 OPC 提效没考虑" (no thought given to OPC efficiency). The two audiences have opposed success criteria — the OPC needs control, reuse, debuggability, and safe iteration; the SMB end user needs simplicity, accuracy, and safety — and cannot share one Agent surface without interfering.

## Decision

Treat **design-time** (OPC) and **runtime** (SMB end users) as two disjoint product faces. The OPC gets a modeling **workbench** (an editable evolution of the `/ontology` page) where the Agent is invoked as an assistant but the human controls commits; the SMB end users get a read-only querying Agent over the **published** Ontology. This mirrors Palantir's FDE tooling split (Ontology Manager + Pipeline Builder + AIP Evals for the FDE; a delivered LLM-grounded app for end users) rather than a single conversational surface.

Four design-time accelerators, all required before launch, are sequenced on a shared **Draft → Publish** state foundation (see ADR-0031): **(0) draft/publish state → (1) schema reverse-inference into a Draft → (2) accuracy Evals gating Publish → (3) reusable ontology template library.** Evals precede templates because a template is only worth sinking if it has been validated — generic models give generic answers; value comes from grounding in the client's own nouns and verbs, verified.

## Considered Options

- **Single Agent, skills trimmed by role** — smaller change, but the two workflows' interaction models, histories, debugging needs, and security boundaries still collide in one chat. Rejected.
- **Workbench-primary, chat demoted to a panel** — closest to Foundry, largest build. Deferred; current choice keeps chat as the assistant within a workbench.

## Consequences

- `/ontology` becomes the OPC workbench; `/query` (currently a redirect stub) and `/chat` are reframed as the runtime surface.
- Reference model is the FDE playbook: ship-fast modeling, closed-loop validation, branch-style review. See CONTEXT.md "Delivery Roles".
- The field-level-permission bypass (recorded in memory) graduates from de-scoped to in-scope only if/when untrusted runtime roles are introduced; the design/runtime split makes that boundary explicit.
