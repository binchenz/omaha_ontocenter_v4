# IngestRecipe + runRecipe is the canonical shape for one-shot customer ingest

The drama-co engagement (ADR-0014, ADR-0015) accumulated 8 ingest passes over two source-database pivots; each pass was an imperative stanza in `import-film-ai-v2.ts`. The pivot from v1 to v2 forced every stanza to be rewritten. To stop the next customer onboarding from paying the same tax, ingest is now expressed as a list of `IngestRecipe` values consumed by a single `runRecipe(recipe, ctx)` deep module.

## What the recipe shape captures

Per recipe: `objectType`, `read(ctx)`, optional `parentRef` xor `relationships(row, ctx)`, optional `entityResolution`, and either `toInstance` or `toInstances` (per-row fan-out). The runner owns: parent-id lookup with skip-and-count, candidate-pool caching, scoped name resolution, per-row error catching, batched import, and uniform summary logging. The orchestrator owns: source pre-load, recipe ordering, summary tally, exit-code policy.

## Sibling to Mapping, not replacement

`IngestRecipe` lives alongside the platform-level `Mapping` concept defined in CONTEXT.md. A `Mapping` is tenant-configured Connector + Sync Job infrastructure that runs on a schedule via the platform's runtime. An `IngestRecipe` is engineer-authored, code-defined, runs once during onboarding, and lives in `scripts/`. They share the goal of translating source rows into Object Instances; they differ in lifecycle, ownership, and persistence.

## When to promote to platform Mapping

The trigger to consider lifting recipe-shaped work into platform-level Mapping infrastructure (e.g. an FK-aware Mapping engine, a runtime recipe runner registered on the Connector) is **the second customer reuses recipes successfully**. One customer's recipes are not a generalisation; two customers' recipes are. Until then, keeping IngestRecipe in `scripts/` avoids speculative platform investment.

## What this ADR explicitly does not do

- Add an `IngestRecipe` table or model to the platform schema.
- Replace any existing `Mapping` consumer or `Sync Job` runner.
- Add a `dependsOn` field to recipes; ordering is positional in the orchestrator's array. The trade-off was accepted during grilling — `dependsOn` is YAGNI for an 8-recipe array.
