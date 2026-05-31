---
status: accepted
supersedes: ADR-0030 (audience-bound surfaces) — partial; the design/runtime *concept* survives, the people-to-surface binding does not
---

# Surfaces follow tasks, authorization follows roles — decouple the two axes

## Context

ADR-0030 split the product into a **design-time** OPC workbench and a **runtime** SMB Agent, and treated them as "two disjoint faces bound to two disjoint audiences": the OPC does design-time, SMB end users do runtime (read-only NL Q&A). ADR-0035 then made this binding mechanical — `isDesignTimeUser(permissions)` derives *which surface you see* from your role.

The project owner rejected the people-to-surface binding as too coarse. The real situation in an SMB:

- An SMB has more than a boss — it has developers / technical operators too.
- There are (at least) three task families, each warranting its own surface: **(1) data consumption** — query / analyse / report; **(2) data maintenance**; **(3) data creation** (new schema). Plus the **Pipeline** surface from ADR-0037.
- The boss, an SMB developer, and the OPC can each legitimately perform *different subsets* of these tasks. The OPC is no longer the *only* design-time actor — an SMB developer may maintain the ontology (schema layer).

So "which surface" is not a function of "which person." ADR-0030/0035 conflated two independent axes.

## Decision

**Decouple the two axes:**

- **Surface ← task.** The product is organised into task-shaped surfaces (consume / maintain / create / Pipeline), each with its own interaction model. Different tasks get different surfaces — for *everyone*, regardless of role.
- **Authorization ← role.** Who may perform a given task, and within what scope, is governed by role permissions (the existing `Role` + `permissions[]` model, ADR-0035). A person sees the surfaces their role authorizes.

This keeps ADR-0030's genuine insight — design-time and runtime *interaction models* are different and must not be crammed into one chat — while discarding its mistaken corollary that design-time belongs to one audience and runtime to another. The OPC/SMB-developer/boss distinction becomes a **permission** distinction, not a **surface** distinction.

ADR-0035's permission vocabulary survives and is in fact *strengthened* by this: it was already moving toward permission-derived capability. What changes is that permissions gate **tasks**, and surfaces are assembled from the tasks a principal is authorized for — rather than a binary `isDesignTimeUser` flag choosing one of two apps.

### Scope clarification: "data maintenance/creation" means the ontology (schema) layer

Grilled explicitly. The owner's "维护 / 新建" refers to the **Ontology (schema)** layer — Object Types, Properties, Relationships — *not* to a generic Object-Instance write path (the platform has no general instance create/update outside declared Actions, ADR-0004, and this ADR does not add one). So an SMB developer authorized for ontology maintenance edits the ontology Draft through the same design-time machinery the OPC uses (ADR-0031 Draft/Publish), gated by permission.

## Considered Options

- **Keep ADR-0030/0035 audience-bound surfaces** — rejected: cannot express "an SMB developer maintains schema" without either handing them the whole OPC identity or inventing a third audience; the binary `isDesignTimeUser` has no room for partial design-time authorization.
- **A `surface` column on Role** (decouple surface from permission contents) — rejected for the same reason ADR-0035 rejected it: a second source of truth for a fact the permissions already encode. Tasks map to permissions; surfaces assemble from authorized tasks.
- **Surfaces follow task, authorization follows role** (chosen) — one vocabulary (permissions), surfaces are a pure function of authorized tasks, and the OPC-vs-SMB-developer line is just a different permission set.

## Consequences

- **ADR-0030 partially superseded:** the design-time/runtime *concept* (distinct interaction models, distinct security boundaries, ADR-0031's published-vs-draft) stands; its *audience binding* (OPC=design, SMB=runtime-only) does not. CONTEXT.md "Design-time vs Runtime" reframed from "two audiences" to "two interaction-model families, accessed per task and gated per role."
- **ADR-0035 extended, not replaced:** `isDesignTimeUser` generalises from a binary surface-selector to per-task permission checks; the four enforcement layers (guard / skill-assembly / data-visibility / FE) still apply, now per task-surface rather than per audience. (ADR-0035's #77 enforcement work is still unimplemented — this ADR redefines *what* it gates.)
- **The runtime read-only premise loosens:** runtime is no longer "the SMB face" but "the consumption task-surface"; an SMB developer can also reach the maintenance/creation surfaces if their role grants it. Field-level visibility (ADR-0036) becomes *more* load-bearing, not less — surfaces no longer protect data, only roles do.
- **Deferred (their own grilling):** the exact surface inventory (is it exactly consume/maintain/create/Pipeline, or finer?), the per-surface permission matrix, and precisely which slice of ontology maintenance an SMB developer may touch (all of it? a curated subset? read-only on some types?). This ADR fixes the *axis decoupling*; the surface count and permission matrix are follow-ups.
- **Enforcement mechanics resolved by ADR-0040:** *where* authorization is enforced (the ADR-0035 #77 question) — a single TCB at the service/SDK convergence point reusing `PermissionResolver`, with the controller guard demoted to shallow fast-fail and skill-assembly as a non-TCB relevance layer. The remaining deferral above (surface inventory, the per-surface permission *matrix* contents, the SMB-developer ontology slice) and the front-end surface scaffolding are still open.
- **Front-end scaffolding shape resolved by ADR-0041:** surfaces are URL segments + a `SurfaceContext` (not hidden-link filtering), the `permissions→surface` mapping is a shared-types pure function imported by nav + skill-assembly + guard, and a Conversation's surface is fixed at creation (stable Skill set, ADR-0039). The *contents* still deferred above (exact surface inventory, per-surface permission matrix, surface→Skill table, landing surface) remain open at the knob level.
- **Relationship to ADR-0039:** with surfaces now task-shaped, the Agent's role across them (one conversation vs per-surface) and Skill assembly per surface are settled in ADR-0039.
