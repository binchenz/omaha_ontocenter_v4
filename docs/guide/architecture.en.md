# Architecture

## Module Overview

OmahA OntoCenter is a NestJS monorepo. Core modules:

```
AppModule
├── OntologyModule     — object type definitions, derived properties, index and view lifecycle
├── QueryModule        — data queries, aggregations, DSL-to-SQL compilation
├── ApplyModule        — bulk writes (create/update/delete/link)
├── PermissionModule   — row-level + field-level permissions, DSL expression compilation
├── AgentModule        — LLM orchestration, 14 tools, 3 Skills, SSE streaming
│   └── CoreSdkModule  — unified seam between agent tools and domain services
└── ConnectorModule    — external data source connection configs
```

Shared packages:

| Package | Responsibility |
|---------|----------------|
| `@omaha/db` | Prisma ORM + database schema |
| `@omaha/dsl` | DSL for derived properties and permission filters: parse → analyze → compile |
| `@omaha/shared-types` | TypeScript types shared between frontend and backend |

## Data Flow: Natural Language Query

```
User types a question in the chat UI
  → POST /agent/chat
  → OrchestratorService.run()
    → build system prompt (tool list + active Skill)
    → call DeepSeek LLM (via ResilientLlmClient with timeout + retry)
    → LLM returns tool_calls (e.g. query_objects)
    → Tool.execute() → CoreSdkService → QueryService
      → QueryPlannerService compiles filters to SQL
      → PermissionResolver injects row-level filter predicates
      → Prisma executes query
    → result returned to LLM → natural language response generated
  → SSE stream pushed to frontend
```

## Data Flow: Ontology Change

```
OntologyService.createObjectType()
  → Prisma writes ObjectType record
  → ArtifactManagerService.reconcile()
    → IndexManager creates/updates expression indexes
    → ViewManager creates/refreshes materialized views
```

## Key Design Decisions

| Decision | Summary | ADR |
|----------|---------|-----|
| Agent-first | LLM is the primary interface; tools are capabilities | [ADR-0008](../adr/0008-agent-first-architecture.md) |
| Unified object storage | All ObjectInstances in one table, keyed by `(tenant_id, object_type, external_id)` | [ADR-0002](../adr/0002-object-instances-unified-storage.md) |
| Shared DSL compiler | Derived properties and permission filters share the same parse/compile pipeline | [ADR-0001](../adr/0001-derived-property-dsl.md), [ADR-0003](../adr/0003-permission-condition-shares-filter-dsl.md) |
| Materialized views | One materialized view per ObjectType; queries hit views, not raw tables | [ADR-0020](../adr/0020-per-objecttype-materialized-views.md) |
| Action preview | All writes require a dry-run preview before execution | [ADR-0004](../adr/0004-action-preview-dry-run.md) |

Full architecture decision records: [docs/adr/](../adr/)

## Multi-tenancy

All tables include a `tenant_id` column. The query layer injects tenant filters on every request automatically.

## Security Model

- **Auth**: JWT via `Authorization: Bearer <token>`
- **Row-level permissions**: Permission DSL expressions compiled to SQL WHERE clauses, injected in QueryService
- **Field-level permissions**: PermissionResolver returns an `allowedFields` set; QueryService filters response fields
- **Connector password encryption**: External database passwords encrypted at rest using `CONNECTOR_ENCRYPTION_KEY`
