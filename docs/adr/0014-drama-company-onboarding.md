---
status: superseded by ADR-0015
---

# Drama-company onboarding: snapshot ingest, narrow scope, no platform changes (SUPERSEDED)

> **Status: Superseded by ADR-0015.** This ADR was written under a misidentification of the customer's business path. It treated the `novels` table family (1 row, AI-writing internal test data) as the engagement target. After looking at the actual data, the business path turned out to be `uploaded_books` + `book_analyses` + `chapter_summaries` — the IP-decomposition pipeline that fuels their drama-adaptation business. ADR-0015 records the corrected design. The scope decisions below are kept as historical record.
>
> **Note on scope.** This ADR is an *integration record* for a single customer engagement, not a platform-level decision. Platform decisions extracted from this engagement live in ADR-0012 (relationship reification) and ADR-0013 (`relationships` jsonb is dormant). Read those if you are looking for reusable patterns. Read this one if you are wondering "why did we onboard the drama company *this* particular way."

## Engagement

A drama-production company commissioned us to host their existing decomposition ontology for web novels (拆解). Their data lives in a Postgres database (`film_ai`) they already own; they have ~28 tables, of which the entity-class subset is 9 novel-domain tables (`novels`, `novel_chapters`, `novel_characters`, `novel_character_relations`, `novel_plot_outlines`, `novel_episodes`, `novel_foreshadowing`, `novel_timeline_events`, `novel_items`).

## Decisions

1. **Snapshot ingest, not federation, not replacement.** We pull a one-time copy of their data into our `object_instances` table. We do not federate live queries against their database, and we do not become their store-of-record. They keep running their own pipeline; we host a read-only ontology view of the snapshot for the agent.

2. **Narrow scope: 9 entity tables only.** We exclude `book_analyses` and `chapter_summaries` even though `chapter_summaries` is the largest table (41k rows). `book_analyses`'s jsonb columns (`character_network`, `plot_structure`) mix UI layout fields (`x`, `y`, `roleColor: "bg-purple-500/15..."`) into the data — pulling them in would pollute the ontology with frontend concerns. `chapter_summaries` is excludable because its content is summary text, queryable on demand via a tool rather than stored as instances.

3. **One tenant for the whole company.** Their internal `users.user_id` does not become our `User`. It stays a string property `author_user_id` on `Novel`. Our `User` is whoever from the drama company logs in to use the agent — typically one or two operators, not their SaaS end-users.

4. **`CharacterRelation` is a first-class `ObjectType`.** Their `novel_character_relations` table carries `relation_type` and `knowledge_state` — attributes on the link itself. We reify per ADR-0012 rather than try to attach metadata to `objectInstance.relationships` jsonb.

5. **Foreign keys → relationships via a one-shot Node script, not via the platform's `Mapping` engine.** Our `ImportEngine` today imports a flat file into one `ObjectType` and dumps every column into `properties`; it does not interpret FK columns as relationships. Building that capability into the platform was rejected as single-customer-driven design. Instead, `scripts/import-film-ai.ts` reads the customer's 9 tables, walks their declared FKs, and writes our `object_instances` rows with `relationships` jsonb pre-populated.

## What we are *not* doing

- Incremental sync. The ingest is a snapshot; their database changes after ingest will not propagate.
- Write-back. The agent answers questions but does not modify their data.
- A platform-level "FK-aware mapping" or "instance-level relationship attributes" feature. If multiple customers later need either, that is the trigger to design platform support — not this engagement.

## Why this shape

The narrow + snapshot + script approach delivers a working agent against real data on a 1-2 day timeline, with zero platform changes. It also leaves every alternative open: snapshot can become incremental sync later; read-only can become read-write later; narrow scope can grow. The reverse — committing to federation or replacement up front — would force platform changes whose requirements we cannot yet validate.
