# market_metric 年份维度:摄入时派生为存储字段,而非查询时计算

## Status

accepted

## Context

一次 Agent 测试("电饭煲近两年趋势")暴露了一类系统性错误:月度数据(`market_metric`,EAV 长表,每行一个 `品类×月份×指标`)Agent 如实搬运、零幻觉,但"按年汇总"这一步**没有 tool 支撑**——`aggregate_objects` 只能 `group by 月份`(`25.01` 这种 `YY.MM` 字符串),无法 `group by 年`。于是 Agent 被迫在回答里**手算跨月加总**:它把 2025 全年零售额写成 56.02 亿(真实 57.02 亿,一位数转写笔误),这个错数又往下游污染了零售额同比(+2.4% → 实际 +4.2%)、年均价、均价同比。25 个月 × 3 指标共 75 个月度格全部精确命中,唯一的错来自这步无凭证的心算。

根因:**凡是 tool 无法确定性给出的聚合,Agent 就会自己算,且会算错、无凭证。** 解法是把"按年汇总"下沉成一次确定性 tool 调用,Agent 永不心算跨月。

## Decision

给 `market_metric` 增加 `year` 维度,**在摄入时从 `month` 派生并写入 `properties.year`(存储字段)**,而非在查询时用 `substring(month,1,2)` 现算(计算维度)。`year = month.slice(0,2)`,write-once,与 `month` 同源不漂移。落地点:

1. `toMarketMetricRawRow`(avc-stars.ts)写 `year: r.month.slice(0,2)`;`MARKET_METRIC_DEF.properties` 加 `{name:'year', label:'年份', filterable, sortable}`;`dimensions` 不变(year 非必填,可选 group-by)。
2. 回填存量:一条幂等 `UPDATE ... SET properties = properties || jsonb_build_object('year', left(properties->>'month',2))`,仅 market_metric ~1593 行,纯 DB 不读 Excel。
3. AVC skill 补一句:零售均价是**比率**,年度均价须用 `sum(年额)/sum(年量)`,勿对均价行求和或平均(B1,prompt 文档而非硬护栏)。
4. **仅 market_metric**。brand_share 的 `period` 本就是年度快照(`24.12`/`25.12`),加 year 退化冗余;model_metric 月度但指标全是比率(share/avgPrice),跨年 sum 无意义且会诱导比率求和死路。

## Considered Options

- **计算维度(rejected)**:在 OntologyView 加 `computedDimensions`,改 `query-planner.service.ts:180` 的 `group by` 分支为 `substring(...)`。看似只动一行,实则 `assertGroupable` 白名单、ADR-0057 的 defaults 注入、`available-values`(`SELECT DISTINCT properties->>'year'`)三套机制全都假设维度是**存储字段**,计算维度会让它们各自返回 null,得在**每一处**加计算分支。存储字段一次性流过全部三套机制,查询层零改动。
- **planner 硬护栏防比率求和(deferred)**:给指标标 `aggregation:'none'`、planner 检测跨周期 `sum(零售均价)` 抛结构化错误。本次 Agent 并未走"对均价行求和"这条死路(它用的是正确的总额/总量),为未观察到的错法上硬护栏属过度工程;先用 B1 文档覆盖,真在测试里观察到再升级并记 backlog。

## Consequences

- month/year 双存:`year` 是 `month` 的纯函数派生,任何写 month 的路径必须同写 year(目前唯一路径是 `toMarketMetricRawRow`),否则 year 缺失。回填脚本可作幂等修复。
- 与 ADR-0058 同向:**摄入时从源派生**,查询层不做现算。与 ADR-0057 维度约束机制兼容(year 走同一套 filterable/groupable 通路)。
- 日后若要改成计算维度,需删存储字段 + 改三处查询机制,成本不低——这正是记此 ADR 的原因。

## 实施后记:对已上线租户做派生字段下沉,改 DEF + 回填数据**不够**(已知陷阱)

第一轮实施改了四处(代码常量 `MARKET_METRIC_DEF`、写入路径 `toMarketMetricRawRow`、AVC skill prose、实例数据回填),自测全绿,却仍然没生效——重跑同一个"电饭煲近两年"测试,Agent **照旧** `group by ["month","metric"]` 后手算,2025 又报 56.02 亿。

根因是漏了**第五处:租户 DB 里那条已存在的 `ObjectType` 记录**。`get_ontology_schema`、schema summary、`OntologyViewLoader`(`filterableFields`)全部读 **DB 的 ObjectType 记录**,而不是代码常量。已上线租户的数据早已 ingest 完毕,不会再触发 ontology republish 去把代码常量同步进 DB——所以 Agent 视角里 `year` **根本不存在**:既不在 schema 里(它不会去 group),`assertGroupable` 的白名单里也没有(即便它想 group 也会被拒)。"代码定义 → 运行时 schema"这条链路对存量租户是断的。

补齐需要两步,都幂等、纯增量、不碰 instance / 不改任何份额数字:

5. **同步 live ObjectType 记录**:把 `{name:'year', filterable:true, sortable:true}` append 进 DB 里该租户 market_metric 的 `properties`(仅缺失时加)。→ 让 schema 暴露 year + `assertGroupable` 放行。
6. **刷新物化视图**:`REFRESH MATERIALIZED VIEW CONCURRENTLY` market_metric 的 matview。`query_objects`(plan 路径)读 matview 的 `properties` **快照**,旧快照不含回填的 year(刷新前 0/1593,刷新后 1593/1593),不刷则按 year 过滤全空。(`aggregate_objects` 直读基表,基表已带 year,故聚合路径只靠第 5 步即可;第 6 步专为 query_objects。)

补齐后重跑验证:Agent 首个 tool_call 即 `aggregate_objects(groupBy:["year","metric"])`,DB `SUM` 直出 2025=57.02 亿、YoY 额 +4.2%、加权均价 +14.2%,56.02 笔误消失。

**可复用结论**:对任何**已上线租户**做派生字段下沉(本 ADR / ADR-0058 这类"摄入时派生"变更),除了改 DEF + 回填实例数据,**必须**同步 live `ObjectType` 记录并刷新该类型的 matview,否则 Agent 视角里该字段不存在。新建租户走正常 ingest/publish 链路不受影响——此坑只针对存量租户的"事后下沉"。

### 复现 / 回归手段(scripts/)

- `verify-rice-cooker-trend.ts <slug>` — 裸 SQL 直读 object_instances,打印电饭煲月度表 + 年度 roll-up + 加权均价,作为 Agent 输出的**独立 ground truth**(不经 Agent、不经 matview)。
- `repro-rice-cooker-chat.ts <slug> ["msg"]` — 进程内驱动 `orchestrator.run()`(与 `/agent/chat` 同一代码路径,真实 DeepSeek + 真实工具),dump 完整 tool-call 轨迹 + 终稿。判定修复是否生效的唯一可信手段:看首个 market_metric 聚合的 `groupBy` 是否含 `year`。
- `backfill-market-metric-year.ts <slug>` — 第 2 步(回填实例数据,幂等)。
- `sync-market-metric-year-schema.ts <slug>` — 第 5+6 步(同步 ObjectType 记录 + 刷新 matview,幂等纯增量)。**对存量租户做本 ADR 的下沉时,这一步是必需的,不是可选的。**
