# PRD: Platform Refactoring — Module Decomposition, Declarative Edits, Materialized Views

## Problem Statement

The Omaha OntoCenter platform has grown organically around a monolithic agent module (10 subdirectories, 4 cross-module dependencies) that handles conversation management, LLM orchestration, skill routing, tool execution, and SDK operations in a single NestJS module. This coupling creates three scaling bottlenecks:

1. **Team scaling**: developers cannot work on skills independently without understanding orchestrator internals.
2. **Product scaling**: adding new skills or object types requires touching shared code paths; the unified `object_instances` table with JSONB properties degrades at medium scale (100K–10M instances per tenant).
3. **Reliability**: 19% test coverage, no structured observability, imperative action handlers that can leave partial-write states.

## Solution

A phased refactoring that decomposes the agent module into four bounded responsibilities, introduces a declarative write model for actions, and adds per-objectType materialized views for query performance. The migration is incremental (strangler fig pattern) — each phase delivers value independently and maintains a working system throughout.

## User Stories

1. As a skill developer, I want a stable SDK interface to build against, so that I can develop and test skills without understanding orchestrator internals.
2. As a skill developer, I want my skill to be an independent unit with its own tools and activation conditions, so that I can iterate without coordinating with other skill developers.
3. As a platform engineer, I want conversation lifecycle management separated from LLM orchestration, so that I can modify session handling without risking skill execution logic.
4. As a platform engineer, I want ActionHandlers to return declarative ObjectEdit[] instead of writing directly to the database, so that I can validate, audit, and preview all mutations before they commit.
5. As a platform engineer, I want a unified Apply layer that validates edits against the ontology schema and commits atomically, so that partial-write states become impossible.
6. As a platform engineer, I want per-objectType materialized views, so that queries on medium-scale data (100K–10M instances) use column-based indexes instead of JSONB parsing.
7. As a platform engineer, I want materialized views refreshed synchronously within the write transaction, so that users see their data immediately after import or mutation.
8. As a QA engineer, I want ActionHandler tests that assert on returned ObjectEdit[] without needing a real database, so that action logic is fast and cheap to verify.
9. As a QA engineer, I want integration tests on the SDK layer before it's extracted, so that the extraction has a safety net.
10. As a QA engineer, I want integration tests on QueryService and QueryPlanner, so that the highest-risk untested code (455 LOC planner) is covered before refactoring.
11. As a tenant administrator, I want queries on large object types to return in predictable time, so that the agent doesn't time out on aggregation or filter operations.
12. As an end user, I want data I just imported to be immediately queryable, so that I can verify imports in the same conversation.
13. As a frontend developer, I want the chat page decomposed into reusable components (MessageList, ToolCallCard, InputBar, ConversationSidebar), so that I can modify one piece without breaking others.
14. As a frontend developer, I want a thin component library based on shadcn/ui patterns, so that new pages share consistent styling without custom CSS.
15. As an operator, I want structured logging with request-level tracing (request → skill activation → LLM call → tool execution → response), so that I can diagnose latency and failures.
16. As an operator, I want LLM calls to have timeout + retry with exponential backoff, so that transient API failures don't crash conversations.
17. As an operator, I want generated SQL to have statement timeouts, so that a bad query plan can't exhaust database connections.

## Implementation Decisions

### Module Decomposition (ADR-0018)

- Agent module splits into: **Conversation** (session lifecycle, message persistence, context window), **Orchestrator** (LLM calls, tool-call loop, skill activation), **Skills** (independent units), **SDK** (ontology operation facade).
- Skills cannot call each other. Shared capabilities live in the SDK layer.
- SDK splits into **Core SDK** (read/write instances, query, ontology metadata — all skills) and **Infrastructure SDK** (connectors, index management — injected per-skill).
- Migration order: SDK first → Conversation → Orchestrator/Skills last.
- Each extraction step must pass existing tests before proceeding.

### Declarative ObjectEdit Model (ADR-0019)

- ActionHandlers return `ObjectEdit[]` with five operations: create, update, delete, link, unlink.
- `update` uses **full replacement** semantics (complete properties object, not partial patch).
- Apply layer validates against ontology schema, checks permissions, commits atomically.
- Preview (ADR-0004) becomes the same ObjectEdit[] rendered as dry-run — no separate code path.
- Existing tools (returning `Promise<unknown>`) migrate incrementally via compatibility shim.

### Materialized Views (ADR-0020)

- Each ObjectType gets a materialized view expanding JSONB properties into real columns.
- ObjectTypeIndex Registry (ADR-0011) manages view creation, column mapping, refresh lifecycle.
- QueryPlanner compiles DSL filters into SQL targeting materialized views.
- Refresh is synchronous within the Apply layer's transaction (strong read-after-write consistency).
- Bulk operations (ingest) defer refresh to end-of-batch.
- `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires a unique index on the view — Registry ensures this.

### Skill Contract Interface

```
Skill {
  name: string
  activationCondition: (context) => boolean | number
  tools: ToolDefinition[]
  systemPrompt?: string
}
```

Orchestrator collects registered skills, evaluates activation, assembles tools + prompts for LLM, routes tool calls to skill handlers.

### Frontend Architecture

- Chat-first interaction model with auxiliary GUI for ontology management.
- Chat page decomposes into: MessageList, ToolCallCard, InputBar, ConversationSidebar.
- Component library uses shadcn/ui pattern (Radix UI + Tailwind).
- State management: React Server Components + minimal client state. No Redux.
- Ontology management: table + form UI, no complex visualization.

### Reliability

- LLM calls: timeout + retry (exponential backoff), output format validation, graceful degradation on tool-call loop limit.
- Query layer: SQL statement timeout, result set size limits on all paths.
- Observability: structured logging (pino), request-level tracing of critical path.

### Team Ownership Model

- **Platform layer** (1-2 senior engineers): Orchestrator, Conversation, SDK, Query, DSL.
- **Skill layer** (parallelizable): each skill is independent, new developers onboard via SDK interface only.
- **Frontend** (1 engineer): independent cadence, consumes core-api.

## Testing Decisions

A good test verifies external behavior through the module's public interface. It does not assert on internal state, private methods, or implementation details. Tests should break only when behavior changes, not when internals are refactored.

### What gets tested

| Phase | Module | Test Type | Approach |
|-------|--------|-----------|----------|
| 1 (SDK extraction) | OntologySdkService | Integration | Real database, verify CRUD operations on object instances |
| 1 (SDK extraction) | QueryService + QueryPlanner | Integration | Real database, verify DSL → SQL → correct results |
| 2 (Conversation extraction) | Conversation lifecycle | End-to-end | Mock LLM, verify create → message → persist → retrieve |
| 3 (Skills/Orchestrator) | Each skill | Contract test | Verify activationCondition and tool registration |
| 3 (Skills/Orchestrator) | Tool-call loop | Unit | Mock LLM returning fixed tool_calls, verify routing and execution |
| Post-refactor | Apply layer | Unit | Assert ObjectEdit[] → correct DB state (real DB) |
| Post-refactor | Materialized view refresh | Integration | Write → verify view reflects change immediately |

### What does NOT get tested

- Frontend (will be rebuilt — tests would be throwaway).
- Prisma generated code (ORM internals are the vendor's responsibility).
- Individual LLM response quality (not deterministic, tested via drama-agent eval scripts).

### Prior art

- `apps/core-api/src/agent/__tests__/agent.service.spec.ts` — existing agent integration test pattern.
- `packages/dsl/src/__tests__/` — DSL unit test pattern (parser, compiler, analyzer).
- `scripts/drama-agent/` — end-to-end agent evaluation pattern.

## Out of Scope

- **Generated SDK (OSDK-style)**: ontology is per-tenant and dynamic; compile-time codegen doesn't apply. Revisit when skill count exceeds ~15.
- **Multi-agent architecture**: product hasn't reached the complexity where distinct agent personas are needed. Revisit when skill count or user intent diversity demands it.
- **Event sourcing**: maximum auditability but massive complexity. Declarative edits provide 80% of the benefit at 20% of the cost.
- **Elasticsearch / search engine**: medium-scale data is handled by materialized views + PostgreSQL indexes. Revisit at >10M instances per objectType.
- **Dataset layer (Palantir-style)**: separating raw data from ontology instances adds a layer of indirection not justified at current scale.
- **CI/CD pipeline changes**: refactoring is internal to the monorepo; Turbo handles incremental builds already.
- **Authentication/authorization redesign**: current auth module is clean and decoupled; no changes needed.

## Further Notes

- All three core ADRs (0018, 0019, 0020) are accepted and committed.
- The refactoring is designed to be interruptible — each phase delivers standalone value. If resources are pulled mid-way, the system is still in a better state than before.
- The Palantir Foundry architecture was used as a reference. The key lesson adopted is the declarative edit model. The key lesson deliberately NOT adopted is generated SDK (doesn't fit dynamic per-tenant ontology).
- Estimated effort: Phase 1 (SDK + tests) ~2 weeks, Phase 2 (Conversation) ~1 week, Phase 3 (Orchestrator/Skills) ~2 weeks, Frontend ~2 weeks, Observability ~1 week. Total ~8 weeks with 1-2 engineers.
