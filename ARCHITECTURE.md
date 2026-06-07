# Architecture Guide

> 读这份文档的前提：先读 `CONTEXT.md`（领域词汇）和 `docs/adr/`（重要决策）。
> 这份文档回答"代码在哪里"，不重复"为什么这样"——那些在 ADR 里。

---

## 三条主线：从用户意图到数据库

所有功能都从 Agent 的一次 Tool 调用开始，沿三条主线之一向下走。

### 主线 1：查数据（只读）

```
用户说 "帮我看电饭煲近3个月趋势"
  → orchestrator 装配 query.skill
  → Agent 调用 query_objects / aggregate_objects Tool
  → query-objects.tool.ts / aggregate-objects.tool.ts
  → CoreSdkService.queryObjects / aggregateObjects
  → QueryService                          ← 权限 + 字段可见性在这里
  → QueryPlanner (query-planner.service.ts)  ← SQL 生成，最深的模块
  → scoped-where.ts                       ← 唯一发出 FROM object_instances 的地方
```

**关键不变量（ADR-0006）**：任何读路径都必须经过 `scoped-where.ts`，它保证 `tenant_id` 隔离和软删除过滤。不要绕过它。

---

### 主线 2：写数据（结构化）

```
用户说 "帮我导入这个 Excel"
  → orchestrator 装配 data-ingestion.skill
  → Agent 调用 import_data Tool
  → import-data.tool.ts
  → CoreSdkService.importData             ← assertCapability('data','ingest') 在这里
  → ImportEngine.importFile / importInstances  ← 单写路径 TCB（ADR-0040）
      ├─ allowedValues 硬校验（拒整批）
      └─ 事务批量 upsert → object_instances 表
```

**关键不变量（ADR-0040）**：所有 Object Instance 的写操作必须经过 `ImportEngine.importInstances`。不要直接写 `prisma.objectInstance`。capability 检查在 `CoreSdkService` 方法里，每个写方法都有自己的 `assertCapability`——加新写方法时必须加。

AVC 报告的写路径在主线 2 上多了一层提取：
```
extract_avc_report Tool
  → CoreSdkService.extractAvcReport
  → AvcTemplateExtractor.extractAll      ← 解析 Excel，不写库
  → MarketMetricImporter.importReport    ← 四星并行写，仍走 ImportEngine
```

---

### 主线 3：语义检索（非结构化，只读）

```
用户说 "用户对净水器怎么说"
  → orchestrator 装配 research-qa.skill
  → Agent 调用 semantic_search Tool
  → semantic-search.tool.ts
  → CoreSdkService.searchResearch
  → SemanticSearchService.search         ← 平行读路径，绕过 QueryPlanner（ADR-0042 §2）
      ├─ EmbeddingClient.embedQuery       ← query 有 Instruct 前缀，passage 无
      └─ pgvector <=> 距离查询 → document_chunks 表
```

**关键不变量（ADR-0042 §2）**：语义检索故意不经过 `QueryPlanner`。向量检索的输入是自然语言，不是 QueryPlan；强行合并会破坏两条路径。两条路径在 `research-qa.skill` 里被 Agent 并联使用（一问同时触发数字查询 + 语义检索）。

---

## 项目结构速查

```
apps/core-api/src/modules/
├── agent/
│   ├── tools/          ← 15个 Tool，每个只做：接收参数 → 调 SDK → 返回结果
│   ├── skills/         ← 4个 Skill，每个声明工具集 + system prompt 片段
│   ├── sdk/            ← ImportEngine（写 TCB）、TypeResolver
│   └── orchestrator/   ← Skill 装配逻辑（relevance层，不是安全门）
├── sdk/
│   └── core-sdk.service.ts  ← Tool 和服务之间的薄层：capability检查 + cache invalidate
├── query/
│   ├── query-planner.service.ts  ← SQL 生成（深模块，不要随意改）
│   ├── query.service.ts          ← 权限、字段可见性、分页
│   └── scoped-where.ts           ← FROM 子句唯一来源
├── ontology/           ← Object Type / Property / Relationship 的 CRUD + Draft/Publish
├── research/
│   ├── avc-template-extractor.ts      ← Excel → 行数据（只读 Excel，不写库）
│   ├── market-metric-importer.service.ts  ← 行数据 → Object Instances（经 ImportEngine）
│   ├── semantic-search.service.ts     ← 向量检索（平行读路径）
│   ├── document-ingestion.service.ts  ← PDF → chunks → embeddings → 库
│   ├── chunker.ts                     ← 纯函数，文本分块
│   └── blob-store.ts                  ← 原始文件存储接口（本地 / 可替换）
└── permission/         ← PermissionResolver（hasCapability 的运行时实现）
```

---

## 添加新功能时的检查清单

**加一个新的可查询 Object Type：**
1. 在 OntologyService 创建类型（或通过 Agent 的 `create_object_type` Tool）
2. 通过 `ImportEngine.importInstances` 导入数据
3. `query_objects` / `aggregate_objects` 立刻可用，无需改代码

**加一个新的 Tool：**
1. 在 `agent/tools/` 新建文件，实现 `AgentTool` 接口
2. 如果是写操作，在 `CoreSdkService` 加对应方法，方法开头加 `assertCapability`
3. 在 `agent.module.ts` 注册
4. 决定这个 Tool 属于哪个 Skill（或新建一个 Skill）

**加一个新的 AVC 数据层（新 Object Type）：**
1. 在 `market-metric-importer.service.ts` 底部加 schema 常量（`_DEF` 对象）
2. 加对应的 `import*()` 方法，调 `ensureObjectType + importEngine.importInstances`
3. 在 `importReport()` 里并入
4. 更新 `research-qa.skill.ts` 的 system prompt 引用新 Object Type 名（用常量，不用字符串）

---

## 不要动的模块

- **`query-planner.service.ts` + `scoped-where.ts`**：最深的模块，改错了整个读路径崩。有改动需求先写 spec 再动。
- **`@omaha/shared-types` 的权限函数**（`hasCapability` / `surfacesFor` / `isDesignTimeUser`）：前端、后端、Agent 路径共用，改接口要三处同步。
- **`EmbeddingClient` seam**（`embedding-client.interface.ts`）：ark 和 local-e5 两个适配器已经在后面，接口稳定就不要动。
