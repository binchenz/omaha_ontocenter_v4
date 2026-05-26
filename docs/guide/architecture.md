# 架构设计

## 模块总览

OmahA OntoCenter 是一个 NestJS monorepo，核心模块如下：

```
AppModule
├── OntologyModule     — 对象类型定义、派生属性、索引和物化视图生命周期
├── QueryModule        — 数据查询、聚合、DSL 编译为 SQL
├── ApplyModule        — 批量写操作（创建/更新/删除/关联）
├── PermissionModule   — 行级 + 字段级权限，DSL 表达式编译
├── AgentModule        — LLM 编排、14 个工具、3 个 Skill、SSE 流式输出
│   └── CoreSdkModule  — Agent 工具与领域服务之间的统一接口层
└── ConnectorModule    — 外部数据源连接配置
```

共享包：

| 包 | 职责 |
|----|------|
| `@omaha/db` | Prisma ORM + 数据库 schema |
| `@omaha/dsl` | 派生属性和权限过滤器的 DSL：parse → analyze → compile |
| `@omaha/shared-types` | 前后端共享的 TypeScript 类型 |

## 数据流：自然语言查询

```
用户在聊天界面输入问题
  → POST /agent/chat
  → OrchestratorService.run()
    → 构建系统提示（工具列表 + 当前 Skill）
    → 调用 DeepSeek LLM（经 ResilientLlmClient 包装，含超时和重试）
    → LLM 返回 tool_calls（如 query_objects）
    → Tool.execute() → CoreSdkService → QueryService
      → QueryPlannerService 将过滤条件编译为 SQL
      → PermissionResolver 注入行级过滤谓词
      → Prisma 执行查询
    → 结果返回 LLM → 生成自然语言回答
  → SSE 流式推送到前端
```

## 数据流：本体变更

```
OntologyService.createObjectType()
  → Prisma 写入 ObjectType 记录
  → ArtifactManagerService.reconcile()
    → IndexManager 创建/更新表达式索引
    → ViewManager 创建/刷新物化视图
```

## 核心设计决策

| 决策 | 说明 | ADR |
|------|------|-----|
| Agent 优先 | LLM 是主要交互界面，工具是能力载体 | [ADR-0008](../adr/0008-agent-first-architecture.md) |
| 统一对象存储 | 所有 ObjectInstance 存在同一张表，按 `(tenant_id, object_type, external_id)` 区分 | [ADR-0002](../adr/0002-object-instances-unified-storage.md) |
| DSL 共享编译器 | 派生属性和权限过滤器使用同一套 DSL，共享 parse/compile 管道 | [ADR-0001](../adr/0001-derived-property-dsl.md), [ADR-0003](../adr/0003-permission-condition-shares-filter-dsl.md) |
| 物化视图 | 每个 ObjectType 一张物化视图，查询走视图而非原始表 | [ADR-0020](../adr/0020-per-objecttype-materialized-views.md) |
| 操作预览 | 所有写操作先 dry-run 预览，用户确认后执行 | [ADR-0004](../adr/0004-action-preview-dry-run.md) |

完整的架构决策记录见 [docs/adr/](../adr/)。

## 多租户

所有数据表均含 `tenant_id` 字段。查询层在每次请求时自动注入租户过滤，无需业务代码手动处理。

## 安全模型

- **认证**：JWT，通过 `Authorization: Bearer <token>` 传递
- **行级权限**：Permission DSL 表达式编译为 SQL WHERE 子句，在 QueryService 中注入
- **字段级权限**：PermissionResolver 返回 `allowedFields` 集合，QueryService 过滤响应字段
- **Connector 密码加密**：使用 `CONNECTOR_ENCRYPTION_KEY` 对外部数据库密码加密存储
