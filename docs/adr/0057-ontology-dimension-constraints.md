# ADR-0057: Ontology Dimension Constraints — 查询维度的系统级约束

**Status:** Accepted  
**Date:** 2026-06-15  
**Deciders:** binchenz

## Context

全量 AVC 数据导入后（50 份 Excel，10 品类 × 5 周期，25,437 条），Agent 的交付报告通过率从 87%（单期数据）骤降至 35%（多期数据）。

根因分析表明问题不在单一层，而是**三层同时失效**：

| 层 | 问题 |
|----|------|
| 问题层 | CHM-2 `"纯米在电饭煲排第几名？"` 未指定 period → 5 期数据都有 |
| Agent 层 | 无系统级"必须约束 period"语义 → Agent 自由探索，返回跨期混合结果 |
| Judge 层 | "last-wins"提取假设最后一个 tool_result 是精确答案 → multi-period 时不成立 |

**核心洞察：** 问题是结构性的——当前 Ontology 里 `period`/`month`/`category` 只是 JSONB 里的普通 filterable string，跟 `brand`、`sourceReport` 没有语义区别。系统不知道"查 brand_share 不指定 period 是无意义的"。

**参考 Palantir Foundry 做法：**
1. **Object Set 预过滤** — Agent 查询的不是全量数据，而是已按维度 scope 的子集
2. **Time Series Property** — 时间序列是独立类型，`getLastPoint` 天然避免歧义
3. **Function-Backed Context** — 业务规则在代码层执行，LLM 之前就消除歧义

我们选择最接近 Function-Backed Context 的路线：**在 QueryPlanner 编译层注入维度约束检查**。

## Decision

### 1. ObjectType 增加 `dimensions` 声明

在 `object_types` 表新增 `dimensions JSONB DEFAULT '{}'` 列，结构：

```typescript
interface DimensionConstraints {
  /** 查询时必须约束的维度 — 缺失则返回 structured error + available values */
  required: string[];
  /** 查询时未约束则自动注入默认值的维度 */
  defaults: Record<string, string>;
}
```

`dimensions` 与 `properties` 正交：properties 定义数据模型（类型、可过滤性），dimensions 定义查询行为规则。

### 2. AVC 三星的维度声明

```typescript
// market_metric
dimensions: {
  required: ['category', 'month'],
  defaults: {},
}

// brand_share
dimensions: {
  required: ['category', 'period'],
  defaults: { priceBand: '整体' },
}

// model_metric
dimensions: {
  required: ['category', 'month'],
  defaults: {},
}
```

设计原则：
- **required**：没有无歧义默认值的分区键。"最新期"不是默认值——趋势分析需要多期。
- **defaults**：有明确业务默认语义的维度。`priceBand='整体'` = "不按价格段拆分"。

### 3. QueryPlanner 编译层行为

在 `plan()` 和 `planAggregate()` 的入口处（filter 校验之后、SQL 生成之前）：

```typescript
// Step 1: 注入 defaulted dimensions
for (const [dim, defaultValue] of Object.entries(view.dimensions?.defaults ?? {})) {
  const hasFilter = args.filters.some(f => f.field === dim);
  if (!hasFilter) {
    args.filters.push({ field: dim, operator: 'eq', value: defaultValue });
  }
}

// Step 2: 检查 required dimensions
for (const dim of view.dimensions?.required ?? []) {
  const hasFilter = args.filters.some(f => f.field === dim);
  if (!hasFilter) {
    const available = await this.getDistinctValues(tenantId, objectType, dim);
    return {
      dimensionError: {
        code: 'DIMENSION_REQUIRED',
        message: `${objectType} 查询需要指定 ${dim} 过滤条件`,
        field: dim,
        available,
        hint: `请在 filters 中添加 { field: "${dim}", operator: "eq", value: "..." } 后重试`,
      },
    };
  }
}
```

### 4. Tool 层返回格式（非 HTTP 400）

dimension error 不抛异常，而是作为 tool_result 的结构化返回值：

```json
{
  "error": "DIMENSION_REQUIRED",
  "field": "period",
  "available": ["22.12", "23.12", "24.12", "25.12", "26.04"],
  "hint": "请在 filters 中添加 period 条件后重试"
}
```

这让 Agent 能自主修正（选最新期并重试），不需要问用户、也不会触发 NestJS 全局 exception handler。

### 5. OntologyView 扩展

```typescript
export interface OntologyView {
  // ... existing fields
  dimensions?: DimensionConstraints;
}
```

`OntologyViewLoader.load()` 从 DB 读取 `objectType.dimensions` JSON 并填充到 view。

### 6. Available Values 查询

```sql
SELECT DISTINCT properties->>$1 AS val
FROM object_instances
WHERE tenant_id = $2::uuid
  AND object_type = $3
  AND deleted_at IS NULL
  AND properties->>$1 IS NOT NULL
ORDER BY val
```

轻量查询，走 GIN 索引。结果可缓存（维度值变化频率低——仅在数据导入时变化）。

## Consequences

### Positive
- **结构性消除多期歧义** — Agent 被迫显式选择 period，不会返回跨期混合数据
- **priceBand 默认注入** — "品牌份额 TOP5"自动 scope 到整体市场，不需要 prompt 规则
- **Agent 可自主修正** — available values hint 让 Agent 一次重试就能成功，无需额外 tool call 探索
- **Judge 通过率回升** — 单期数据 + 正确 priceBand 恢复到单期测试时的行为
- **可扩展** — 新 Connector（渠道数据、区域数据）只需声明 dimensions，无需改 QueryPlanner 代码

### Negative
- **多一次 DB migration** — object_types 表加列
- **趋势分析场景需要特殊处理** — Agent 问"份额趋势"时想要多期数据，但 required 约束会阻止无 period 查询。需要 Agent 用 `operator: 'in'` 或范围条件（gte/lte）而非省略 period
- **available values 查询开销** — 每次 required 缺失时一次 DISTINCT 查询（可缓存缓解）

### 趋势场景的兼容

required 约束的语义是"必须约束"，不是"必须单值"。以下查询合法：
- `{ field: "period", operator: "in", value: ["22.12","23.12","24.12"] }` — 多期
- `{ field: "period", operator: "gte", value: "24.12" }` — 范围

只有完全不带 period filter 才会触发 DIMENSION_REQUIRED error。

## Alternatives Considered

### Alternative A: Prompt-only 守护

在 query skill 里加"若用户未指定 period，默认使用最新期"。

❌ 拒绝原因：
- LLM 不一定遵守（当前 35% 通过率就是证据）
- 每新增一个维度键都要加 prompt 规则
- 不能处理 defaulted 维度（priceBand 注入需要改 SQL，prompt 做不到）

### Alternative B: Property 级别的 dimension 标记

```json
{ "name": "period", "dimension": { "required": true } }
```

❌ 拒绝原因：
- 维度约束是查询行为语义，不是数据类型属性
- 同一 property 在不同场景可能有不同约束规则
- 定义散落在每个 property 里，不如 ObjectType 级别集中声明清晰

### Alternative C: Object Set 预过滤（Palantir 风格）

会话创建时锁定 scope（如 "26.04 电饭煲"），Agent 只能查这个子集。

❌ 拒绝原因：
- 过度限制——用户可能一句话问"电饭煲"，下一句问"养生壶"
- 需要实现 ConversationContext.scope 机制（大重构）
- 趋势分析天然需要跨期

## Implementation Notes

### 文件变更清单

| 类型 | 文件 | 变更 |
|------|------|------|
| Migration | `packages/db/prisma/migrations/20260615_dimension_constraints/` | ALTER TABLE 加列 |
| Schema | `packages/db/prisma/schema.prisma` | ObjectType model 加 `dimensions Json @default("{}")` |
| Types | `packages/shared-types/src/ontology.ts` | 新增 `DimensionConstraints` 接口 |
| DSL | `packages/dsl/src/ontology-view.ts` | OntologyView 加 `dimensions?` 字段 |
| Loader | `apps/core-api/src/modules/ontology/ontology-view-loader.service.ts` | 读取并填充 dimensions |
| Planner | `apps/core-api/src/modules/query/query-planner.service.ts` | 入口处维度校验逻辑 |
| Service | `apps/core-api/src/modules/query/query.service.ts` | 处理 dimensionError 返回 |
| AVC | `apps/core-api/src/modules/research/market-metric-importer.service.ts` | 三个 DEF 加 dimensions |
| Test | `apps/core-api/src/modules/query/query-planner.service.spec.ts` | 新增维度约束测试 |

### Migration SQL

```sql
ALTER TABLE object_types ADD COLUMN dimensions JSONB NOT NULL DEFAULT '{}';

-- 回填 AVC 三星
UPDATE object_types SET dimensions = '{"required":["category","month"],"defaults":{}}'
  WHERE name = 'market_metric';
UPDATE object_types SET dimensions = '{"required":["category","period"],"defaults":{"priceBand":"整体"}}'
  WHERE name = 'brand_share';
UPDATE object_types SET dimensions = '{"required":["category","month"],"defaults":{}}'
  WHERE name = 'model_metric';
```

## References

- ADR-0056: AVC Pipeline Pass-Through（本 ADR 的前置：数据层就绪后暴露的查询层问题）
- [Palantir AIP Retrieval Context Types](https://palantir.com/docs/foundry/agent-studio/retrieval-context/)
- [Palantir Time Series Property API](https://palantir.com/docs/foundry/api/v2/ontologies-v2-resources/time-series-properties/)
- [Palantir Community: Object Query prompt issues](https://community.palantir.com/t/important-improvements-needed-to-automated-prompt-instructions/4858)
- Delivery Report 测试结果：单期 87% → 多期 35%（2026-06-14 run）
