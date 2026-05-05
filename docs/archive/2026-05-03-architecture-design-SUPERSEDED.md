# Architecture Design: Omaha OntoCenter V4

## 1. Overview

Omaha OntoCenter V4 is an ontology-native enterprise intelligence platform that enables SMEs to query business data (orders, customers, payments, reviews) using natural language. The system is built on a business object ontology layer rather than direct SQL, with controlled action execution and full audit trails.

**Core differentiator:** NL → Business Intent → Ontology Validation → Object Query Plan → Permission Injection → Query Execution → Action Preview → User Confirmation → Audit.

## 2. Architecture: Core + Agent Worker

Two-process architecture with a single PostgreSQL database.

### 2.1 Core API (NestJS)

The main API server handling all business logic. Port 3000.

**Modules:**

| Module | Responsibility |
|--------|---------------|
| auth | JWT authentication, login, tenant context injection |
| tenant | Tenant CRUD, settings management |
| ontology | Object type definitions, relationships, derived properties |
| mapping | Connector config, field mapping, data sync |
| query | Object Query Engine — compiles query plans to PostgreSQL JSONB queries |
| permission | RBAC with object/field/row/action level access control |
| action | Action definitions, preview generation, confirmed execution |
| audit | Audit log writing and querying |
| conversation | Chat history storage, SSE streaming endpoint |
| skill | Skill CRUD for admin management |

**Common infrastructure:**
- `AuthGuard` + `TenantGuard` — all requests scoped to authenticated user + tenant
- `AuditInterceptor` — automatic audit logging for sensitive operations
- Global exception filter with structured error responses

### 2.2 Agent Worker (Standalone Process)

Dedicated process for AI orchestration. Consumes jobs from pgboss, calls LLM API, executes tools via Core API.

**Components:**

| Component | Responsibility |
|-----------|---------------|
| agent-loop | Core loop: LLM call → parse response → execute tools → loop or end |
| prompt-builder | Assembles system prompt from base prompt + ontology context + active skills |
| skill-loader | Loads and selects relevant skills from DB based on user intent |
| tool-executor | HTTP calls to Core API internal endpoints with auth context |
| stream-manager | Pushes SSE events to frontend via Core API |
| llm/ | LLM Adapter layer with provider implementations |

### 2.3 Communication

- **Frontend ↔ Core API:** REST API + SSE (Server-Sent Events) for streaming
- **Core API ↔ Agent Worker:** pgboss (PostgreSQL-backed job queue), no Redis needed
- **Agent Worker ↔ Core API:** HTTP calls to internal endpoints for tool execution

## 3. Agent Skill System

Skills are prompt-level behavior instructions dynamically loaded into the Agent's system prompt. They guide HOW the Agent uses tools for specific business scenarios, similar to Claude Code's skill system.

### 3.1 Skill Architecture

**Three-layer system prompt assembly:**
1. **Base Prompt** — Agent identity, behavior rules, safety constraints, output format
2. **Ontology Context** — Current tenant's object definitions, relationships, derived properties, user permissions
3. **Active Skills** — Dynamically loaded based on user intent

### 3.2 MVP Skills

| Skill | Priority | Trigger | Purpose |
|-------|----------|---------|---------|
| order-query | P0 | User intent is querying business objects | Guides the full query workflow: validate ontology → handle ambiguity → present plan → confirm → execute → format results |
| semantic-clarification | P0 | Always loaded | Handles ambiguous semantics: when multiple candidate fields match user expression, must ask clarifying questions |
| action-execution | P1 | User intent includes business actions | Guides action workflow: query targets → preview → confirm → execute → report |
| data-analysis | P2 | User intent is analysis/statistics | Guides multi-query analysis: decompose → aggregate → present with tables |

### 3.3 Skill Storage & Loading

- **Storage:** `skill_definitions` table in PostgreSQL. Admin can CRUD via UI.
- **Format:** Each skill has: name, trigger_conditions (JSONB), content (TEXT), is_always_on flag, priority, enabled flag.
- **tenant_id nullable:** null = system-level skill (shared), non-null = tenant-specific skill.
- **Loading per turn:**
  1. Always-on skills loaded every time
  2. Intent-matched skills via keyword/classifier on user message
  3. Context-matched skills based on prior tool usage in conversation
- **Token budget:** Total skill content capped at ~2000 tokens to leave room for ontology context.

## 4. LLM Adapter Layer

Unified interface abstracting LLM provider differences. Default provider: DeepSeek.

### 4.1 Interface

```typescript
interface LLMProvider {
  chat(req: ChatRequest): Promise<ChatResponse>
  chatStream(req: ChatRequest): AsyncIterable<StreamEvent>
}

interface ChatRequest {
  systemPrompt: string
  messages: UnifiedMessage[]
  tools: ToolDefinition[]
  temperature?: number
  maxTokens?: number
}

interface ChatResponse {
  text: string | null
  toolCalls: ToolCall[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
  usage: { inputTokens: number; outputTokens: number }
}

type StreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; args: string }
  | { type: 'done'; response: ChatResponse }
```

### 4.2 Providers

| Provider | SDK | Notes |
|----------|-----|-------|
| DeepSeekProvider (default) | `openai` SDK, baseURL: `api.deepseek.com` | Model: `deepseek-chat`. OpenAI-compatible format. |
| ClaudeProvider (future) | `@anthropic-ai/sdk` | Different tool_use block format, needs normalization. |
| OpenAIProvider (future) | `openai` SDK | Standard function_calling format. |

**Switching:** Environment variable `LLM_PROVIDER=deepseek|claude|openai`. Factory function `createProvider(config)` instantiates the correct implementation.

## 5. Agent Tools

Six atomic tools available to the Agent. Each maps to a Core API internal endpoint.

| Tool | Endpoint | Description |
|------|----------|-------------|
| query_objects | POST /internal/objects/query | Execute an Object Query Plan. Takes objectType, filters, include, select, limit. Returns structured results. |
| get_ontology_schema | GET /internal/ontology/:objectType | Retrieve object definitions, properties, relationships, derived properties. For query plan validation. |
| preview_action | POST /internal/actions/preview | Generate action preview (e.g., create tasks for N orders). Returns what would happen without executing. |
| execute_action | POST /internal/actions/execute | Execute a confirmed action. Requires previewId from prior preview_action. Cannot skip preview. |
| clarify_with_user | (pauses loop) | Pause agent loop, send clarifying question via SSE, wait for user response. |
| present_query_plan | (pauses loop) | Show generated query plan to user for review. User can confirm or modify. |

**Safety constraint:** `execute_action` requires a valid `previewId` from `preview_action`. The Agent cannot bypass the preview step.

## 6. Data Model

PostgreSQL 16, single instance. 14 tables across 5 domains.

### 6.1 Auth & Multi-tenancy

```sql
tenants (id UUID PK, name, slug, settings JSONB, created_at)
users (id UUID PK, tenant_id FK, email, name, password_hash, role_id FK, created_at)
roles (id UUID PK, tenant_id FK, name, permissions JSONB, created_at)
```

All tables carry `tenant_id` for strict tenant isolation.

### 6.2 Ontology & Mapping

```sql
object_types (id UUID PK, tenant_id FK, name, label, properties JSONB, derived_properties JSONB, version, created_at)
object_relationships (id UUID PK, tenant_id FK, source_type_id FK, target_type_id FK, name, cardinality, created_at)
connectors (id UUID PK, tenant_id FK, name, type ENUM, config JSONB ENCRYPTED, status, created_at)
object_mappings (id UUID PK, tenant_id FK, object_type_id FK, connector_id FK, table_name, property_mappings JSONB, relationship_mappings JSONB)
```

### 6.3 Object Instances

```sql
object_instances (
  id UUID PK,
  tenant_id FK,
  object_type TEXT,
  external_id TEXT,
  label TEXT,
  properties JSONB,        -- all business fields
  relationships JSONB,     -- foreign keys to other instances
  source_ref JSONB,
  search_text TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(tenant_id, object_type, external_id)
)

sync_jobs (id UUID PK, tenant_id FK, connector_id FK, status ENUM, started_at, completed_at, records_processed INT, records_failed INT, error_log JSONB)
```

### 6.4 Agent, Skills & Audit

```sql
conversations (id UUID PK, tenant_id FK, user_id FK, title, created_at, updated_at)
conversation_turns (id UUID PK, conversation_id FK, role ENUM, content TEXT, tool_calls JSONB, tool_results JSONB, created_at)
skill_definitions (id UUID PK, tenant_id FK NULLABLE, name, description, trigger_conditions JSONB, content TEXT, is_always_on BOOL, priority INT, enabled BOOL)
audit_logs (id UUID PK, tenant_id FK, actor_id FK, actor_type ENUM, operation TEXT, object_type TEXT, query_plan JSONB, result_count INT, source ENUM, created_at)
```

### 6.5 Action Engine

```sql
action_definitions (id UUID PK, tenant_id FK, name, label, object_type TEXT, input_schema JSONB, preconditions JSONB, permission TEXT, requires_confirmation BOOL, risk_level ENUM)
action_previews (id UUID PK, tenant_id FK, action_def_id FK, user_id FK, target_ids UUID[], input_params JSONB, preview_result JSONB, status ENUM, expires_at TIMESTAMP, created_at)
action_runs (id UUID PK, tenant_id FK, preview_id FK, user_id FK, status ENUM, result JSONB, error JSONB, started_at, completed_at)
```

### 6.6 Key Indexes

```sql
-- Object query performance
CREATE INDEX idx_instances_tenant_type ON object_instances(tenant_id, object_type);
CREATE INDEX idx_instances_properties ON object_instances USING GIN(properties);
CREATE INDEX idx_instances_search ON object_instances USING GIN(search_text gin_trgm_ops);

-- Audit queries
CREATE INDEX idx_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);

-- Conversation history
CREATE INDEX idx_turns_conversation ON conversation_turns(conversation_id, created_at);
```

## 7. Request Flow

Complete sequence for a natural language query: "昨天杭州已付款好评订单"

1. **Browser** → POST /api/chat/message { conversationId, message }
2. **Core API** → Save user message → Create pgboss job → Return SSE stream URL
3. **Browser** → Connect to GET /api/chat/{id}/stream (SSE)
4. **Agent Worker** → Pick up job → Load ontology + skills → Build system prompt
5. **Agent Worker** → Call DeepSeek API (streaming) → Stream text tokens → SSE: {type: "text"}
6. **Agent Worker** → DeepSeek returns tool_use: present_query_plan → SSE: {type: "query_plan", plan: {...}}
7. **Browser** → Show query plan UI → User clicks "确认执行"
8. **Browser** → POST /api/chat/message { conversationId, message: "确认" }
9. **Agent Worker** → Resume loop → DeepSeek calls query_objects → SSE: {type: "tool_status"}
10. **Agent Worker** → HTTP POST Core /internal/objects/query (with user auth context)
11. **Core API** → Permission injection → Compile JSONB query → Execute → Return results
12. **Agent Worker** → Feed results to DeepSeek → Format response → SSE: {type: "result", data: [...]}
13. **Agent Worker** → Save conversation turn + Write audit log → SSE: {type: "done"}

## 8. Monorepo Structure

Turborepo + pnpm workspaces.

```
omaha-ontocenter/
├── package.json                # Turborepo root
├── turbo.json
├── docker-compose.yml          # PostgreSQL + Core + Agent + Web
│
├── apps/
│   ├── core-api/               # NestJS — port 3000
│   │   └── src/modules/        # 10 NestJS modules
│   ├── agent-worker/           # Standalone Node.js process
│   │   └── src/
│   │       ├── agent-loop.ts
│   │       ├── prompt-builder.ts
│   │       ├── skill-loader.ts
│   │       ├── tool-executor.ts
│   │       ├── stream-manager.ts
│   │       ├── llm/            # LLM Adapter layer
│   │       │   ├── llm-provider.ts
│   │       │   ├── deepseek.provider.ts
│   │       │   └── index.ts
│   │       └── tools/          # 6 tool implementations
│   └── web/                    # Next.js 14 — port 3001
│       └── src/app/
│           ├── (auth)/login/
│           └── (dashboard)/
│               ├── chat/       # Main AI query interface
│               ├── ontology/
│               ├── connectors/
│               ├── mappings/
│               ├── permissions/
│               ├── skills/
│               ├── audit/
│               └── settings/
│
├── packages/
│   ├── shared-types/           # TypeScript types shared across apps
│   └── db/                     # Prisma schema + migrations
│
└── seeds/                      # Demo data
```

## 9. Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | NestJS 10 + TypeScript |
| ORM | Prisma |
| Job Queue | pgboss (PostgreSQL-backed) |
| LLM | DeepSeek API via `openai` SDK (with LLM Adapter for future switching) |
| Auth | passport-jwt |
| Frontend | Next.js 14 (App Router) |
| UI Components | shadcn/ui + Tailwind CSS |
| Data Tables | TanStack Table |
| Streaming | SSE (EventSource) |
| Database | PostgreSQL 16 (JSONB + GIN indexes) |
| Monorepo | Turborepo + pnpm workspaces |
| Local Dev | Docker Compose |

## 10. MVP Scope Alignment

This architecture supports all P0 items from the PRD:

- Login & tenant → auth + tenant modules
- Data source ingestion → mapping module + connectors
- Ontology definition → ontology module
- Mapping config → mapping module
- Object Query API → query module
- Derived properties (isPaidAt, latestReview, latestReviewIsPositive) → query module + ontology JSONB
- NL → Query Plan → agent-worker + skills
- Permission filtering → permission module (auto-injected into queries)
- Audit logging → audit module + AuditInterceptor
- Query result table → web/chat page + TanStack Table
