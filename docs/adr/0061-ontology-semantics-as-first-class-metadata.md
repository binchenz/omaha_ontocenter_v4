# ADR-0061: Ontology Semantics as First-Class Metadata — 把本体语义从 Skill 散文上提为一等元数据

**Status:** Proposed
**Date:** 2026-06-16
**Deciders:** binchenz

## Context

ADR-0042/0044/0057 确立的 AVC 本体（三颗扁平事实星 `market_metric` / `brand_share` / `model_metric`，价格段存区间不存标签，事实×维度走查询期 Field Path）在数据正确性上是站得住的。本 ADR **不触碰**这套星型骨架——grain、星的边界、"不强行归一"的决策都保留。

问题出在另一个维度:**本体对 Agent 是"哑"的**。Agent 正确使用本体所依赖的语义，有一大半不在本体结构里，而是写在 `research-qa.skill.ts`（117 行）的自然语言散文里。一次对该 skill 的审计发现，至少 25 行是在用 prose 补本体表达不出来的语义:

| skill 里的散文规则 | 它在补本体的什么结构性缺失 |
|----|----|
| "priceBand 默认折叠为整体…**绝不可断言 brand_share 无价格段数据**" | 本体表达不了"维度存在但被默认折叠"——Agent 看不到被折叠的维度，只能靠散文喊话别误判 |
| "model_metric 是 **TOP-100 样本，非全市场**…不等于 brand_share" | 本体没有"抽样宇宙（universe）"这个一等概念——两星 grain 差异只能靠散文反复强调 |
| "零售均价是**比率，不可加**…必须销量加权" | 属性没有"可加性（additivity）"语义——Agent 不知道哪些字段能 SUM，只能被散文逐个警告 |
| "③④跳前**必须先查 avc_report 的 coverage**" | 星之间没有声明式 relationship——"查 model 前先验 coverage"靠散文串，不是本体可导航的边 |

**核心洞察:** 这是结构性短板，不是文案问题。ADR-0057 已经为**查询行为约束**（required/defaults 维度）开了 `object_types.dimensions` 这个本体元数据层的口子；但**本体的内在语义属性**（一个数值能不能相加、一颗星是不是全量宇宙、一个维度是否默认折叠）仍然散落在 Agent 的 prompt 里，而它们本该是本体自己的事实。

**为什么这对 chat 效果是真问题（不是洁癖）:**

1. **散文非结构化，LLM 会漏读、会权重错配。** [[dimension-default-blindspot]] 是活的实证:Agent 真的因为默认折叠而错误断言"brand_share 无价格段数据"，逼着我们**加更多散文**去救——一个负向循环（本体表达不了 → 加散文 → 散文更长 → 更易漏 → 加更多散文）。
2. **规则与数据会漂移且静默错。** "可加性""抽样宇宙""默认折叠"是本体的内在属性，却写在 Agent prompt 里。改星、改默认值时本体变了散文忘同步，Agent 就拿过期规则推理，且不报错。
3. **换 surface / 换 skill 就全丢。** 这些语义绑死在 `research-qa` 一个 skill 上。新开一个"高管周报"surface 就得把 25 行散文再抄一遍。本体级真相不该是 skill 级复制品。

**前置:** ADR-0057 建了 `dimensions` 列并证明了"在本体元数据层声明、在编译/注入层强制"这条路有效。本 ADR 是同一条路的延伸——把更多本体语义放进同一个元数据层。

## Decision

把三类本体内在语义从 skill 散文**上提为 ObjectType / Property 级的一等元数据**，让 Agent 通过**读 schema**（Tier-1 `get_ontology_schema`，ADR-0050）就拿到，而不是通过背 prompt。**不改星型 grain，不建新的维度星**（价格段存区间不存标签的决策保留，ADR-0042）。

### 1. 属性可加性 `additivity`（最高优先）

在 Property 定义上增加 `additivity` 标记:

```typescript
type Additivity =
  | 'additive'      // 可跨任意维度 SUM（零售额、零售量）
  | 'non-additive'  // 任何维度都不可加（份额——跨段相加无意义）
  | 'ratio';        // 比率，跨维度聚合须用加权（零售均价 = Σ额 ÷ Σ量）

interface PropertySemantics {
  additivity?: Additivity;
  /** ratio 字段的加权方案，供聚合层解释 */
  ratioOf?: { numerator: string; denominator: string };
}
```

AVC 标注:
- `market_metric.value`（零售额/零售量）→ `additive`；零售均价 → `ratio { numerator: '零售额', denominator: '零售量' }`
- `brand_share.value`（份额）→ `non-additive`
- `model_metric.valueShare/volumeShare` → `non-additive`；`avgPrice` → `ratio`

**这是当前最易产 invisible-wrong-answer 的点**——把均价直接平均，数字看着对其实错。本体一旦标了 additivity，聚合层/Agent 在 schema 里就读得到"这个字段不能 SUM"。

### 2. 抽样宇宙 `universe`（ObjectType 级）

把"TOP-100 样本 vs 全市场"从散文警告升为一等元数据:

```typescript
interface ObjectTypeSemantics {
  /** 该星的采样宇宙——不同 universe 的星不可互相冒充 */
  universe?: 'whole-market' | 'top-sample' | string;
  /** 同 universe 的可比同伴；跨 universe 数字差异属预期，须注明口径 */
}
```

AVC 标注:`brand_share` → `whole-market`；`model_metric` → `top-sample`；`market_metric` → `whole-market`。Agent 读到两星 universe 不同，就**结构性**地知道"不能拿 model 汇总冒充 brand_share 官方份额"，无需散文那句"绝不把 SKU 汇总当官方份额"。

### 3. 维度可见性 `collapsed`（与 ADR-0057 `dimensions` 合流）

ADR-0057 的 `dimensions.defaults` 已经在**注入**默认值，但 Agent **看不到**这件事发生（[[dimension-default-blindspot]] 的根因）。给被默认折叠的维度加显式可见标记:

```typescript
interface DimensionConstraints {     // 扩展 ADR-0057 的同名接口
  required: string[];
  defaults: Record<string, string>;
  /** 声明"此维度存在但默认折叠"，Agent 从 schema 即可见，须主动钻取而非反向断言其不存在 */
  collapsedDefault?: Record<string, string>;
}
```

`brand_share` 标 `collapsedDefault: { priceBand: '整体' }`。schema 注入时把这条渲染成一句结构化提示（"priceBand 维度存在、默认折叠为整体、分段数据始终存在、需显式 groupBy 钻取"），取代散文里最长那段喊话。

### 4. 注入路径（复用已有结构，不新建机制）

- `PropertySemantics` / `ObjectTypeSemantics` 落在 `object_types` 的现有 JSONB 列上（`properties` 内联 additivity，新增 `semantics` 顶层键放 universe），**沿用 ADR-0057 的元数据层模式**，不加新表。
- `OntologyViewLoader.load()` 读出并填进 `OntologyView`（与 0057 的 `dimensions` 同路）。
- Tier-1 schema 渲染（`get_ontology_schema`，ADR-0050）把这三类语义编进 ObjectType detail，使 Agent **选定一颗星后**即从 schema 读到全部语义。Tier-0 菜单不变（存在性永不截断）。

### 5. 成功判据

**改造成功 = `research-qa.skill.ts` 能从 117 行瘦下去**——那 25 行散文规则变成 Agent 从 schema 直接读到的结构化事实。散文越薄，本体对 Agent 越"会说话"。skill 退回它该干的事:**相关性/编排**（ADR-0040 的"skill = relevance layer"），而非充当本体语义的影子副本。

## Consequences

### Positive
- **消除一类 invisible-wrong-answer** — additivity 让"均价不可直接平均""份额不可跨段相加"成为本体事实而非 prompt 期望
- **universe 混淆结构性消失** — Agent 从 schema 就知道两星口径不可互换
- **折叠维度不再被反向断言为"无数据"** — 直接修掉 [[dimension-default-blindspot]] 的根因，而不是再加散文去救
- **语义随本体走，不随 skill 走** — 新 surface / 新 skill 自动继承，不必复制散文
- **可扩展** — 新 Connector / 新星只需声明 semantics，无需改 skill 和 QueryPlanner
- **沿用 ADR-0057 的元数据层与 ADR-0050 的 Tier-1 注入** — 无新表、无新机制

### Negative
- **一次 schema 扩展 + 回填** — 给现有三星补标 additivity/universe/collapsed（一次性，数据量极小）
- **Tier-1 schema 体积略增** — 每个 ObjectType detail 多带语义字段；落在 fetch-on-need 的 Tier-1，不碰 Tier-0 存在性不可截断的不变量（ADR-0050）
- **聚合层需读 additivity 才能真正拦截误聚合** — 本 ADR 先让语义"可见"（Agent 读得到）；让聚合层**强制**加权（ratio 字段自动 Σ/Σ、non-additive 字段拒绝 SUM）是更深一层，可作为后续切片
- **散文不会一次清零** — 决策链编排（停-确认、四跳顺序，ADR-0049）本就属于 skill 的编排职责，应留在 skill；只上提**本体语义**，不上提**编排流程**

## Alternatives Considered

### Alternative A: 继续 prompt-only（现状）

把所有语义留在 skill 散文里，靠加更多句子修每一次误判。

❌ 拒绝原因:已被实证证伪——[[dimension-default-blindspot]] 就是 prose 没拦住的真实事故；且每加一个维度/字段就要加一段散文，跨 surface 还要复制。这正是 ADR-0057 拒绝 Alternative A（prompt-only 守护）的同一理由，本 ADR 是那条逻辑的延续。

### Alternative B: 改造星型结构（建品牌/品类/价格段维度星）

把扁平字符串属性抽成真正的维度 ObjectType + relationship。

❌ 拒绝原因:与本问题正交，且对价格段是**错的**——价格段是区间不是实体，冻结一套规范段集违反 ADR-0042；品牌/品类规模下建维度星是 YAGNI（无频繁变更的码表场景）。chat 效果的短板是"语义不可见"，不是"结构不够范式化"。**骨架对，别动。**

### Alternative C: 把语义塞进每个 Property 的自由 JSON，不定类型

用无 schema 的 `meta: {...}` 装任意键。

❌ 拒绝原因:退回另一种"非结构化"。additivity/universe/collapsed 是有限枚举的一等概念，定死类型才能让 loader、schema 渲染、（未来）聚合层三方共读同一契约——与 ADR-0057 把 `dimensions` 定成强类型接口同理。

## Implementation Notes

| 类型 | 文件 | 变更 |
|----|----|----|
| Types | `packages/shared-types/src/ontology.ts` | 新增 `Additivity` / `PropertySemantics` / `ObjectTypeSemantics`；扩展 `DimensionConstraints.collapsedDefault` |
| DSL | `packages/dsl/src/ontology-view.ts` | `OntologyView` 加 `semantics?` + property-level additivity |
| Loader | `apps/core-api/src/modules/ontology/ontology-view-loader.service.ts` | 读取并填充新语义字段 |
| Schema 渲染 | `get_ontology_schema` Tier-1 组装处 | 把 additivity/universe/collapsedDefault 编入 ObjectType detail |
| AVC | `apps/core-api/src/modules/research/market-metric-importer.service.ts` | 三星 DEF 补标 semantics |
| Skill | `apps/core-api/src/modules/agent/skills/research-qa.skill.ts` | 删除被上提的语义散文（可加性/宇宙/折叠维度），保留编排（停-确认、四跳） |
| Migration | `packages/db/prisma/migrations/<ts>_ontology_semantics/` | 回填三星 semantics（数据量小，可在 importer DEF 内完成，未必需独立 migration） |
| Test | `query-planner` / schema 渲染相关 spec | 断言 schema 暴露 additivity/universe/collapsed |

**实施顺序建议（TDD 切片，与 plan 一致）:** ①声明类型 → ②AVC 三星标注 + loader 读取 → ③Tier-1 schema 渲染暴露 → ④删 skill 散文并验通过率不退 →（后续切片）聚合层按 additivity 强制加权/拒聚合。

## References

- ADR-0042: Market Intelligence 三星共存、决策优先、不强行归一（本 ADR 明确**保留**其骨架）
- ADR-0044: 事实×维度走查询期 Field Path（本 ADR 不改这条边界）
- ADR-0050: Schema Menu 存在性不截断 / Tier-0 vs Tier-1（语义注入落在 Tier-1）
- ADR-0057: Ontology Dimension Constraints（本 ADR 的直接前置——同一元数据层，扩展其 `dimensions`）
- ADR-0040: skill = relevance layer（本 ADR 把 skill 推回其编排本职）
- 记忆 [[dimension-default-blindspot]]:折叠维度被 Agent 反向断言为"无数据"的实证事故——本 ADR 的根因证据
- 审计:`research-qa.skill.ts` 117 行中 ~25 行为本体语义散文（2026-06-16）
