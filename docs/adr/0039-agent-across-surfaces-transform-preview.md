---
status: accepted
---

# One Agent across task-surfaces; surface drives Skill assembly; Pipeline transforms are dry-run → confirm

## Context

Two earlier decisions are now in tension with the new product shape:

- **ADR-0008** declared the Agent "the product itself" — a *single* conversational loop at one `/chat` entry, and explicitly rejected multi-Agent routing (cross-domain operations like "import this Excel then query A-grade customers" lose context when split).
- **ADR-0010** made Skill activation an all-active union, because per-turn intent classification mis-routes exactly the ambiguous cross-domain messages that matter.

ADR-0038 reorganises the product into task-shaped surfaces (consume / maintain / create / Pipeline). ADR-0037 adds a Pipeline surface where the owner wants the Agent to participate (e.g. "normalise the `mood` field into these values" → Agent authors a transform step). This raises two questions neither ADR-0008 nor ADR-0010 answered: **is there one Agent across surfaces or one per surface? and how is the Skill set chosen now that there are surfaces?**

## Decision

### 1. One Agent, surface-driven Skill assembly

Keep ADR-0008's single conversational loop. Do **not** spawn a per-surface Agent. Cross-domain continuity — ADR-0008's core reason for a single Agent — still matters: "import then query" must remain one conversation, and per-surface Agents would sever it.

What changes: **the current surface becomes an explicit input to Skill assembly.** Instead of ADR-0010's all-active union *or* an intent-classifier guess, the surface the user is on declares which Skills load (Pipeline surface → transform-authoring Skill; consume surface → query Skill; etc.). This is the natural extension of ADR-0035's already-decided "per-request, permission-driven Skill assembly" — the driver set widens from `{permissions}` to `{permissions, current surface}`.

This also retires ADR-0010's hardest open problem favourably: ADR-0010 kept the all-active union because *inferring* intent was unreliable. With surfaces, intent is **declared, not inferred** — the user chose the surface — so the tool set narrows safely without a classifier. ADR-0010's tool-scoping seam (kept deliberately as a structural hook) is exactly where this narrowing lands; no re-architecture.

Cross-surface continuity is preserved because it is one Agent with one conversation: moving surfaces changes which Skills are loaded for subsequent turns, not the conversation identity or history.

### 2. Pipeline transforms follow dry-run → confirm

A transform the Agent authors changes data *shape*, affecting every downstream Object Instance and query result — risk no lower than Publish. The project has one consistent discipline for state-changing operations: **dry-run → confirm → execute** (ADR-0004 Action Preview, ADR-0019 declarative edits, ADR-0031 Publish Preflight). Transforms join it as the **fourth instance**.

Concretely: the Agent (or GUI) proposes a transform; the platform runs it on a **Dataset sample** and returns a before/after preview ("329 distinct → 5 normalised values; 12 unmappable rows quarantined"); the OPC confirms; only then is the step written into the Pipeline (ADR-0037). The Agent never silently mutates a Pipeline.

## Considered Options

- **Per-surface independent Agent sessions** — rejected: severs the cross-domain conversation ADR-0008 was built to protect; "import (Pipeline/ingest) then query (consume)" would split into two context-blind sessions.
- **Keep ADR-0010's all-active union unchanged** — rejected: with explicit surfaces, loading every Skill on every turn wastes the now-available signal and keeps irrelevant tools in scope (e.g. transform-authoring tools on the consume surface).
- **Intent-classifier Skill selection** — still rejected (ADR-0010's original reasoning holds), but now moot: the surface *is* the declared intent, so no classifier is needed.
- **Agent writes transforms directly, relying on the Publish gate downstream** — rejected: breaks the project-wide dry-run→confirm discipline; a wrong transform would silently corrupt a Dataset and only surface (maybe) at Publish, far from where it was introduced.

## Consequences

- **ADR-0008 preserved, scoped:** still one Agent / one loop / one product; "single `/chat`" generalises to "one Agent surfaced across task-surfaces," conversation identity unchanged.
- **ADR-0010 superseded in part:** the all-active union yields to surface-driven assembly. The trigger ADR-0010 named (monitoring fires when prompt grows past budget) is overtaken by a better signal — the surface — arriving first. The tool-scoping seam ADR-0010 preserved is the implementation point.
- **ADR-0035 extended:** Skill-assembly driver set becomes `{permissions, surface}`; the enforcement layers are unchanged.
- **ADR-0037 completed on the interaction side:** the transform-edit dry-run→confirm flow promised in ADR-0037's consequences is specified here.
- **Deferred:** the transform-preview's sampling strategy (sample size, how representativeness is guaranteed for quarantine counts) and whether confirming a transform on a sample needs re-confirmation when run on the full Dataset (parallel to ADR-0004's hash-bound re-check). To settle with the transform catalogue.
- **Skill-assembly mechanics resolved by ADR-0040:** the surface-driven Skill set is a *relevance + least-privilege* layer, not a second authorization TCB; it consults `PermissionResolver` in read-only form and turns an over-privileged request into opening guidance for the LLM rather than a post-hoc `ForbiddenException`. The deterministic gate is the service-layer TCB. The transform-preview sampling strategy above remains open.
