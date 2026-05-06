# Drama-company onboarding v2: uploaded_books + book_analyses + chapter_summaries

> **Note on scope.** This ADR supersedes ADR-0014. It is an *integration record* for a single customer engagement, not a platform-level decision. Platform decisions applied in this engagement: ADR-0012 (relationship reification — applied to `BookCharacterEdge` and `ChapterCharacterMention`) and ADR-0013 (`relationships` jsonb is dormant — we deliberately avoid relying on the read path).

## What changed from ADR-0014

ADR-0014 targeted the `novels` table family (9 tables, 1 row). After discovering that `novels` is internal AI-writing test data and the customer's actual business is IP selection via `uploaded_books` (260 books) + `book_analyses` (47 decomposition reports) + `chapter_summaries` (41k chapter-level summaries), we replaced the entire ingest target and ontology shape.

## Engagement

A drama-production company wants to use the Omaha OntoCenter Agent to query their IP candidate library for drama adaptation: screening books by score/genre/pace (A), drilling into a single book's characters and plot (B), and cross-book comparison (C). Their data lives in a Postgres database (`film_ai`) they already own.

## Decisions

1. **Snapshot ingest, not federation, not replacement.** (Unchanged from ADR-0014.)

2. **Full-explode scope: 3 source tables → 8 ObjectTypes, ~177k instances.** Every jsonb array whose items have independent identity (can be individually referenced or queried) is exploded into its own ObjectType. Arrays whose items are attribute-value lists (`keyEvents`, `revelations`) are preserved as `json`-typed properties.

3. **One tenant for the whole company.** (Unchanged from ADR-0014.) `uploaded_books.user_id` stays a string property `user_id` on `Book`, not mapped to our `User`.

4. **`novels` path deleted.** The 1-row `novels` table and its 9 satellite tables are confirmed as internal AI-writing test data. They are removed from the tenant to avoid cognitive noise in the demo. The reusable modules (`tenant-bootstrap`, `ontology-bootstrap`, `object-instance-importer`, `fk-to-relationships`) built for the `novels` path are retained.

5. **Entity resolution for character name strings: explicit status, no ghost entities.** `book_analyses.character_network.edges[]` and `chapter_summaries.structured_summary.characters[]` reference characters by name string, not by id. Resolution uses fuzzy matching against `BookCharacter.name` (strip parenthetical suffixes, match on primary name). Resolved → `book_character_id` populated. Unresolved → `book_character_id` null, `character_name_raw` preserved, `resolution_status` set. No phantom `BookCharacter` instances are created for unresolved names.

6. **`ChapterCharacterMention` as a junction ObjectType.** To avoid sacrificing query performance on "which chapters does character X appear in" (would require GIN index on jsonb contains, which our platform doesn't support), the `characters[]` array in `chapter_summaries` is materialized as a junction ObjectType with btree-indexed `chapter_summary_id` and `book_character_id` columns. This is ADR-0012 applied to the chapter-character relationship.

7. **UI fields discarded.** `character_network.nodes[].x/y`, `character_network.mainChars[].roleColor`, `market_potential.scores[].color` — all frontend rendering data is stripped during ingest. The ontology contains only domain-meaningful attributes.

8. **Flat properties extracted from nested jsonb.** Several scalar or simple values buried inside `book_analyses` jsonb columns are extracted as top-level `Book` properties for filterability: `tags`, `tone`, `pace`, `pov`, `sentence`, `market_overall`, `market_comparison`, `pace_type`, `avg_tension`, `peak_chapter`, `structure_template`, `structure_type`.

## Ontology shape

```
Book                      (260)   ← uploaded_books LEFT JOIN book_analyses
BookCharacter             (260)   ← character_network.mainChars[] EXPLODE
BookCharacterEdge         (253)   ← character_network.edges[] EXPLODE + entity resolution
PlotBeat                  (285)   ← plot_structure.beats[] EXPLODE
EmotionalCurvePoint       (805)   ← emotional_curve.points[] EXPLODE
MarketScore               (235)   ← market_potential.scores[] EXPLODE
ChapterSummary          (41062)   ← chapter_summaries, keyEvents/revelations as json attrs
ChapterCharacterMention (~134k)   ← characters[] EXPLODE + entity resolution junction
```

Total: ~177k instances, 8 ObjectTypes, 8 type-level Relationships.

## What we are *not* doing

- Incremental sync, write-back, platform changes. (Unchanged from ADR-0014.)
- `novels` path (AI-writing test data). Deleted, not deferred.
- GIN indexes on jsonb arrays. ChapterCharacterMention junction ObjectType eliminates the need.
- Ghost/phantom entity creation for unresolved character names. Resolution status is an explicit attribute; unresolved names stay as strings.
- Adaptation assistance (D use case). Deferred to a future engagement if the customer requests it; it requires Action-layer work, not Ontology-layer.
