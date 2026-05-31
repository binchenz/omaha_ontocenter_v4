---
status: accepted
---

# Front-end surface scaffolding: URL-segment surfaces, shared-types-derived nav, conversation-bound surface

## Context

ADR-0038 organised the product into task-shaped surfaces (consume / maintain / create / Pipeline) and deferred "the exact surface inventory" and the per-surface front-end shape. ADR-0039 added that one Agent spans surfaces, the surface drives Skill assembly, and switching surfaces must not break the conversation. ADR-0035 §1 specified that the `permissions → surface` mapping lives in `@omaha/shared-types` as the single source of truth reused by guard + skill-assembly + frontend, with an `isDesignTimeUser(permissions)` helper.

None of this exists in `apps/web` today. A gap analysis found: the nav is a hardcoded three-link array in `(app)/layout.tsx` with zero permission awareness; the front-end `User` type drops `permissions` (keeps only `role: string`), so the FE cannot see the input to surface assembly; the `/agent/chat` request body is `{message, conversationId, fileId}` with no surface/mode/skill-scope field; and the `permissions → surface` mapping (and `isDesignTimeUser`) promised by ADR-0035 was never implemented (`@omaha/shared-types` has no surface constants). So the front-end surface concept is net-new scaffolding, but every wiring point (route group, `useAuth`, `ChatDto`) already exists to attach to.

This ADR fixes the *shape* of that scaffolding — three interlocking decisions — not the nav contents or page designs (those are knobs).

## Decision

### 1. A surface is a URL segment plus a `SurfaceContext`, not a hidden-link filter

Surface becomes a first-class front-end concept: present in the URL and in a `SurfaceContext`, with the nav derived per `{permissions, surface}`. Switching surfaces does **not** unmount the page tree, so the Agent conversation survives the switch (ADR-0039's "switch surface without breaking the conversation"). Rejected: (a) a route-group-per-surface physical split — would require standing up four route groups with their own layouts (create/pipeline have no pages yet, so this means empty shells) and would make surface-switch a navigation that unmounts and severs the conversation unless conversation state is separately hoisted; (c) permission-filtered flat links with no surface concept — does not deliver ADR-0038 (it is exactly the "hide by audience" model ADR-0038 overturned). An unbuilt surface (create/pipeline) simply is absent from the derived nav — no shell needed.

### 2. The `permissions → surface` mapping is a pure function in `@omaha/shared-types`, imported by all three consumers

`surfacesFor(permissions)` and `isDesignTimeUser(permissions)` are pure functions (no DB, no request context — the mapping is just string-membership over the permission array) defined once in `@omaha/shared-types`. Three consumers import the *same* function: the front-end nav, the back-end Skill assembly (ADR-0039), and the back-end RolesGuard (ADR-0035 §4, deferred but coming). This is the literal realisation of ADR-0035 §1. Rejected: (甲) each consumer computes its own mapping — three sources of truth that drift (FE shows the maintain surface while the guard 403s it, or worse the reverse); (乙) the back end computes and `/auth/me` returns a ready-made `surfaces[]` for the FE to consume blindly — unstable, because skill-assembly and the guard do not flow through `/auth/me` and so still need the mapping server-side, collapsing back into (丙) or leaving two server-side copies. (丙) is the stable terminus and is structurally identical to the back-end's "one `PermissionResolver`, many call-sites" (ADR-0040 #4): one pure module, many import points.

This closes the FE type gap as a side effect: to call `surfacesFor(user.permissions)` the FE `User` type must carry `permissions`, so it reuses `@omaha/shared-types`' `CurrentUser`. `/auth/me` stays lean — it already returns `permissions`; the FE computes surfaces locally from the shared function.

### 3. Surface is a property of the Conversation, fixed at creation, not a live reflection of the URL

When a Conversation is created, its surface is taken from the URL at that moment and recorded; every subsequent message in that Conversation carries that surface **even if the user navigates to another surface**. The URL determines a *new* Conversation's surface; it never mutates an *existing* Conversation's surface. So the Skill set is stable across a Conversation's lifetime — it does not flip mid-task because the user clicked the nav. `ChatDto` gains a `surface` field (or the create-conversation request carries it); the back end assembles Skills from `{permissions, surface}` per request, with surface read from the Conversation. Rejected: (甲) read surface live from the URL on every message — switching surfaces mid-conversation would jitter the Skill set (e.g. a half-finished Pipeline-authoring conversation flips from transform Skill to query Skill and back when the user glances at the consume surface), contradicting ADR-0039's "one Agent, stable conversation." This decision matters because more than one surface will host the Agent (consume = query help; Pipeline = transform authoring, per ADR-0037/0039's "Agent participates in the Pipeline"), so the surface must pin the task context the Skill set is assembled for.

## Considered Options

- **Surface as URL segment + context (chosen, §1)** vs route-group-per-surface (empty shells + conversation severed on switch) vs permission-filtered flat links (does not deliver ADR-0038).
- **Mapping as shared-types pure function (chosen, §2)** vs per-consumer mapping (three-way drift) vs back-end-computed `/auth/me` surfaces (unstable; collapses into the chosen option or leaves two server copies).
- **Surface bound to the Conversation (chosen, §3)** vs live-from-URL per message (Skill-set jitter mid-conversation).

## Consequences

- **`@omaha/shared-types` gains surface constants + `surfacesFor`/`isDesignTimeUser`** (pure). This is the single source of truth ADR-0035 §1 named; the deferred back-end guard (ADR-0035 §4) and the surface-driven Skill assembly (ADR-0039) import the same functions when built.
- **The FE `User` type reunifies with `CurrentUser`** (regains `permissions`), closing the type gap where the FE dropped the permission list.
- **`(app)/layout.tsx` nav becomes derived** from `surfacesFor(user.permissions)` × current surface, replacing the hardcoded three-link array. A `SurfaceContext` is introduced.
- **`ChatDto`/conversation gains a `surface`** field; the Conversation model records the surface it was created on, and the back end reads it (not the live URL) when assembling Skills.
- **Routing shape:** surfaces are URL segments; the existing `(app)` route group and `useAuth`/`AuthProvider` stack are reused, not rebuilt. Unbuilt surfaces (create/pipeline) are simply absent from the derived nav until their pages exist — incremental-rollout friendly.
- **Relationship to write-authz:** the nav/surface layer is the *shallow UX layer* of the boundary, never the gate (ADR-0035 §2, ADR-0040 #4–#5). Hiding a surface from the nav is not enforcement; the service-layer TCB is. The shared `isDesignTimeUser` used here is the *same* function the guard will use, so the UX layer and the gate cannot disagree.
- **Deferred (knobs, not architecture):** the concrete surface→Skill mapping table contents, the per-surface nav item list, which surface a user lands on after login, and the create/pipeline page designs. This ADR fixes the scaffolding shape; ADR-0038's "exact surface inventory" remains open at the contents level.
