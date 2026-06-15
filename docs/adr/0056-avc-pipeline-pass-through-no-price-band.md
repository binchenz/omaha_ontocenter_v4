# ADR-0056: AVC Pipeline 退化为 Pass-Through，移除 price_band Step

**Status:** Accepted  
**Date:** 2026-06-14  
**Deciders:** binchenz  
**Amends:** ADR-0055

## Context

ADR-0055 设计的三条 AVC Pipeline 中，model_metric 包含 price_band step，目标是给每个机型打上标准化价格段标签（如 0-500 / 500-1500 / 1500+），让 Agent 可以回答「500元以下的机型市场份额是多少」。

设计时假设价格段可以统一定义。但在实施过程中，通过分析已灌入的 25,437 条真实 AVC 数据，发现：

**问题 1：每个品类的价格段定义不同**

AVC 的 brand_share 数据已携带 priceBand（从 Excel 列头直接抽取），但**价格段因品类而异**：

```sql
-- 实际 DB 查询结果
SELECT properties->>'category' as cat, 
       COUNT(DISTINCT properties->>'priceBand') as band_count
FROM object_instances
WHERE object_type='brand_share' AND properties->>'priceBand' != '整体'
GROUP BY cat;

-- 输出：
养生壶      7 个不同价格段
微波炉      8 个
电水壶     11 个
电压力锅   13 个
饭煲     13 个
电烤箱     14 个
食品料理机 19 个
电磁炉     31 个
煎烤机     33 个
空气炸锅   34 个
```

**问题 2：历年分段演进导致同品类出现多种分段名**

AVC 在不同时期调整过价格段划分，导致同一品类（如空气炸锅）在不同月份的数据中出现 34 种不同的 priceBand 值（包括 "100-119" / "100-120" / "120-139" / "120-140" 等微调）。

**问题 3：品类间价格区间差异巨大**

```sql
-- 各品类机型均价范围
SELECT properties->>'category', 
       MIN((properties->>'avgPrice')::numeric), 
       MAX((properties->>'avgPrice')::numeric)
FROM object_instances WHERE object_type='model_metric'
GROUP BY category;

电水壶:   20 - 1,912 元
电磁炉:   66 - 2,620 元
电饭煲:   97 - 4,142 元
微波炉:  207 - 8,944 元
电烤箱:   89 - 10,672 元
```

一套扁平的 `default_price_bands`（如 ADR-0055 设计的 0-500 / 500-1500 / 1500+）无法适配所有品类：电水壶几乎全部落在 0-500，电烤箱/微波炉大部分落在 1500+，分辨力严重不足。

**问题 4：model_metric 的实际查询场景不需要预计算标签**

分析 Agent 的实际使用模式：
- brand_share（品牌层）是用户问「价格段份额」的主要入口，已有 priceBand（从 Excel 直接抽取）
- model_metric（机型层）的查询场景是「某机型均价多少」或「TOP 机型排名」，不是按价格段分组
- 如果用户问「200-300 元的机型有哪些」，Agent 可以用 `avgPrice >= 200 AND avgPrice < 300` 的数值范围过滤，无需预计算标签

## Decision

**移除 model_metric Pipeline 的 price_band step。三条 Pipeline 退化为极简/纯透传：**

1. **avc_market_metric**: 保留 `filter(value > 0)` — 丢弃 Excel 监测空行
2. **avc_brand_share**: 保留 `normalize_brand(空映射)` — 实际透传，但作为未来品牌归一化的接口钩子（如发现英文别名时可启用）
3. **avc_model_metric**: **零 step** — 纯 pass-through，avgPrice 保留为数值

brand_share 的 priceBand 保留（从 AvcTemplateExtractor 直接抽取 AVC Excel 列头，真实反映 AVC 原文分段）。

## Consequences

### 正面

1. **省掉跨品类分段维护负担**：10 品类 × 平均 20 种分段名 = 200+ 条映射规则，且 AVC 历年调段意味着持续维护成本
2. **省掉函数改造**：当前 `price_band` 函数只支持扁平 bands 数组（`[{max: 500, label: '0-500'}, ...]`），按品类分段需嵌套结构（`{品类→bands[]}`）+ 函数改写
3. **代码更简单**：Pipeline 运行时无 compute step，失败面更小
4. **avgPrice 保留数值语义**：Agent DSL 已支持 `>=` / `<` 运算符，查询引擎可优化数值范围过滤（btree 索引）

### 负面

1. **Agent 需构造数值范围 filter**：`avgPrice >= 200 AND avgPrice < 300` 而不是 `priceBand = '200-300'`
   - 缓解：schema menu 已枚举 avgPrice 为 numeric field（ADR-0050），prompt 会正确引导
   - 实测：现有 agent-scenarios e2e 中数值范围查询准确率与等值查询相当
2. **model_metric 无法按预定义价格段分组聚合**
   - 缓解：brand_share 已有 priceBand，是品牌层价格段分析的主要数据源；机型层极少按段聚合

### 中立

- brand_share 的 priceBand 虽有 34 种杂乱值（历年演进），但**真实反映 AVC 原文**。Agent 可处理变化的段名（LLM 的语义理解能力）

## Alternatives Considered

### (A) 去掉 price_band step（采纳）

**优点**：
- 最简单，无维护负担
- avgPrice 数值语义清晰，查询引擎可优化

**缺点**：
- Agent 用数值范围 filter 而非标签（但 schema menu 已枚举 avgPrice 为 numeric，影响可控）

### (B) 一套粗粒度通用段

TransformConfig 定义 `＜100 / 100-200 / 200-300 / 300-500 / 500-1000 / 1000+`，对所有品类统一打标签。

**优点**：
- 简单实现，一个 TransformConfig
- model_metric 有 priceBand 字段可查

**缺点**：
- 电烤箱/微波炉等高单价品类全落在 1000+，分辨力差
- 与 brand_share 的 AVC 官方段不一致（brand_share 仍有 34 种细分段），跨层对比困难
- 低单价品类（电水壶）全落在 ＜100，同样失去分辨力

### (C) 按品类分段

TransformConfig 存嵌套结构：
```json
{
  "电水壶": [{"max": 60, "label": "0-60"}, {"max": 100, "label": "60-100"}, ...],
  "电饭煲": [{"max": 100, "label": "0-100"}, {"max": 200, "label": "100-200"}, ...],
  "电烤箱": [{"max": 500, "label": "0-500"}, {"max": 1500, "label": "500-1500"}, ...],
  ...
}
```

Pipeline step 根据行的 category 字段查找对应分段。

**优点**：
- 每品类精准，分辨力最高

**缺点**：
- 需改 `price_band` 函数实现（当前只支持扁平数组，改写需支持嵌套查询）
- 10 品类手动维护（初始成本 2-4h）
- AVC 历年调段导致段名演进（如 "100-119" 在 23 年改为 "100-120"），维护成本持续
- 与 brand_share 的实际 priceBand（34 种）仍不完全对齐（brand_share 从 Excel 列头抽取，model_metric 从 avgPrice 计算，两者定义独立）

### 选择 (A) 的原因

1. brand_share 已有 priceBand（用户问价格段份额的主要入口），无需 model_metric 重复实现
2. model_metric 的实际查询场景（TOP 机型排名、某机型均价）不依赖预计算段标签
3. 数值过滤足够（Agent 可构造 `avgPrice >= 200 AND avgPrice < 300`），无需引入 200+ 条分段映射的维护负担

## Implementation Notes

**修改文件**：
- `apps/core-api/src/modules/pipeline/avc-pipeline-provisioner.service.ts`
  - 删除 line 34 `PRICE_BAND_CONFIG` 常量
  - 删除 lines 48-55（seed `avc_price_bands` TransformConfig）
  - 修改 lines 222-244（model_metric spec）：`propertyMappings: identityMap(MODEL_METRIC_DEF)` 不再加 `priceBand: 'priceBand'`，`steps: []` 空数组
- `apps/core-api/src/modules/pipeline/avc-pipeline-provisioner.service.spec.ts`
  - 删除 price_band 相关测试（如有）

**向后兼容**：
- 已 provision 的 draft pipelines 可安全删除重建（status='draft' 未激活，无 live 流量）
- 如已有 `avc_price_bands` TransformConfig，可保留（不被引用时不产生影响）
- 老路径的 model_metric 数据（直写 object_instances）无 priceBand 字段，与新路径一致

**未来扩展点**：
- 如用户强烈需要 model_metric.priceBand（如产品经理自定义价格段分析），可实现 (C) 按品类分段，但需明确业务价值（当前无此需求）
- brand_share 的 normalize_brand step 虽为空映射，但保留接口——如未来发现英文别名（"MIDEA" vs "美的"），可启用映射而不改 Pipeline 结构

## References

- **ADR-0055** 原设计（line 53: "- filter - normalize - price_band"；lines 130-133: price_band step 定义；line 175: seed default_price_bands）
- **纯米交付 grill Q9 决策**：「A: 去掉 price_band step，model 用 avgPrice 数值过滤即可」
- **DB 查询证据**：
  - `SELECT COUNT(DISTINCT properties->>'priceBand') FROM object_instances WHERE object_type='brand_share' AND properties->>'category'='空气炸锅'` 返回 34
  - `SELECT MIN/MAX((properties->>'avgPrice')::numeric) FROM object_instances WHERE object_type='model_metric' GROUP BY category` 显示跨品类价格区间差异 100 倍以上
- **avc-pipeline-provisioner.service.ts** (lines 228-241) 当前实现
- **ADR-0050** schema menu 枚举 avgPrice 为 numeric field
