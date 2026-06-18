# PRD: System Prompt 提升 — 三阶段架构演进

## Problem Statement

纯米 Agent 在 live 评估中暴露三大核心问题：

1. **收敛纪律缺失**：宽泛战略问题（如"帮我分析小米和米家"）触发开放式探索，导致 22+ tool calls 超预算并超时，用户体验差。根因是跨品牌聚合被 additivity 护栏误杀（品牌不重叠但护栏未识别），Agent 只能逐品牌查询再手动合并。

2. **准确性靠 prose 堆叠**：research-qa.skill 硬编码 102 行 prose（3537 tokens）承载所有准确性规则（priceBand=整体跨段汇总、universe 纪律、year 聚合可信性、均价两步法、coverage 诚实、四跳决策链）。接近 PROMPT_BUDGET_ERROR（8000），且新规则只能继续追加 prose，维护成本线性增长。

3. **验证与推理割裂**：EvalQuestion 表存储 (question, baselineTool, baselineArgs) 配对作为 ground truth，但只用于事后验证（runQuestionNTimes），从未作为 grounding 源注入推理。对标 Palantir AIP Evals 的 "trusted examples" / Genie 的 "Trusted SQL" / Cortex 的 "Verified Query Repository"，我们缺失这层 few-shot 引导。

当前架构能交付纯米首单（市场事实查询全对），但无法可持续演进：每增加一个垂直（如财报、供应链），prose 线性膨胀；复杂诊断问题（S6/S7 类）准确率 ~85%，距离生产级 95%+ 还有 gap。

## Solution

分三阶段重构 system prompt 生成架构，从"prose 堆叠"演进到"语义层+验证库+最小 prose"三层协同：

**Phase 1（1-2周）**：修复 live blocking bugs + 最高杠杆 prose 增强
- 实施**跨品牌 disjoint-sum 白名单机制** — 在 AdditivityGuard 检查前识别"品牌不重叠的 filter brand IN [x,y]"，允许跨品牌 SUM 通过，彻底解决 S6/S7 宽问题从 22 calls 降至 <10 calls。
- 增强 research-qa.skill prose 明确告知 priceBand=整体 语义（"整体=预汇总总份额，跨不重叠品牌求和数学合法"），治四病（universe 混淆/真空误判/year 遗忘/均价错算）。
- 修复 BUG-A（drill-gate 多批次确认消息历史崩溃）和 BUG-B（软预算半截 punt）。

**Phase 2（2-4周）**：语义层扩展 + EvalQuestion 积累自动化
- 扩展 semanticsHints 承载 year 聚合、均价两步等可结构化规则，**从 prose 下沉到本体层**（新增 aggregationGuidance 元数据字段）。
- research-qa.skill prose 从 3537 tokens 压缩至 ~3100 tokens（净省 12%），删除已下沉的重复规则。
- 建立 EvalQuestion 自动/半自动积累机制（batch-capture 接口 + metadata.questionType 标注），为 Phase 3 few-shot grounding 铺路。

**Phase 3（长期演进）**：动态 few-shot grounding + 长尾问题准确性提升
- 实施 **EvalQuestion 驱动的动态 few-shot 注入** — embedding 检索 + plan-summarizer 生成中文 examples，预计算缓存策略（cron 后台生成，延迟 <10ms）。
- 复杂诊断问题（S6/S7 类）准确率从 ~85% 提升至 >=93%（+8%）。
- 形成正向飞轮：OPC 审查正确答案 → 自动 capture 入库 → grounding 推理 → 准确率提升 → 更多正确答案。

终态对标 Palantir AIP Evals：prose/hints/examples 三层协同，每层各司其职，可持续演进。

## User Stories

### Phase 1: Live 可用性修复

1. 作为纯米 OPC，我想问"帮我分析小米和米家在整体市场的份额趋势"时，Agent 能在 <10 次 tool calls 内完成（而非当前 22+ 次），这样我不会遇到超时。
2. 作为纯米 OPC，我想问跨品牌对比问题时，Agent 能正确识别"品牌不重叠"并直接在 priceBand=整体 段一次 SUM，而非逐品牌查询再手动合并。
3. 作为纯米 OPC，我想在问"某品牌在某价格段是否有产品"时，Agent 能正确区分"份额低"与"真空"，不要因 TOP-100 样本空缺就误判"该段空白"。
4. 作为纯米 OPC，我想问"2025 年全年零售额"时，Agent 能一次 groupBy[year] 聚合定稿，而非逐月查询手动累加（既慢又易错）。
5. 作为纯米 OPC，我想问"某品类全年均价"时，Agent 能正确用"零售额合计÷零售量合计"而非对多个月的均价行求平均。
6. 作为纯米 OPC，我想在 drill-gate 确认后继续查询时，Agent 不会因消息历史错乱而崩溃（DeepSeek 400 错误）。
7. 作为纯米 OPC，我想在 Agent 达到软预算时，能看到完整的"请基于已有数据作答"提示，而非半截 punt。

### Phase 2: 可维护性与准确性提升

8. 作为垂直开发者（如 AVC vertical），我想在新增一个维度语义规则时，能在 ObjectType 元数据中声明 aggregationGuidance，而非修改 research-qa.skill prose（降低跨模块耦合）。
9. 作为垂直开发者，我想 Agent 能自动从 get_ontology_schema 读取 aggregationGuidance hints，而非依赖 skill prose 重复描述（single source of truth）。
10. 作为 OPC，我想在审查 Agent 答案后点击"批量添加到 Evals"，一次性 capture 多个 question+plan 对，而非逐条点击（降低 friction）。
11. 作为 OPC，我想 EvalQuestion 能自动标注 questionType（fact-query/diagnosis/cross-year），方便后续分析覆盖率。
12. 作为平台运维，我想 research-qa.skill prose 从 3537 tokens 压缩至 ~3100 tokens，为未来新垂直留出 prompt 预算裕度。
13. 作为平台运维，我想 plan-summarizer 支持 semantic_search 工具，能生成中文 summary 用于日志/审计。

### Phase 3: 长尾准确性与自动化

14. 作为纯米 OPC，我想问复杂诊断问题（如"为什么小米份额下滑"）时，Agent 能参考历史相似问题的正确 plan pattern，准确率从 ~85% 提升至 >=93%。
15. 作为纯米 OPC，我想 Agent 在回答我的问题前，能自动检索 EvalQuestion 库中结构相似的 verified examples 作为 grounding，而非每次从零推理。
16. 作为平台运维，我想 few-shot examples 在后台 cron 预计算（每 10 分钟刷新），而非每次 chat 实时生成，这样延迟增量 <10ms 用户无感知。
17. 作为平台运维，我想在 prompt token 超 900 时 few-shot 自动降级（k=3→k=2），超 1800 时优雅跳过并记录 alert，保证核心 prompt 段不受影响。
18. 作为垂直开发者，我想 EvalQuestion 新增记录时自动生成 embedding 并建 HNSW 索引，无需手动维护。
19. 作为平台运维，我想在 Grafana 看到 fewshot_cache_hit_rate / token_budget_skip_count / generation_latency_p95 三个指标，监控 few-shot 系统健康度。
20. 作为 OPC，我想每次我审查并确认的正确答案都自动进入 EvalQuestion 库，形成正向飞轮（越用越准）。

### 跨阶段

21. 作为平台架构师，我想 semanticsHints（结构化）、Few-shot examples（验证驱动）、Skill prose（最小表面）三层各司其职，新垂直接入时只需声明语义元数据和积累 verified queries，无需大量编写 prose。
22. 作为平台架构师，我想对标 Palantir AIP Evals 的 "trusted examples"、Genie 的 "Trusted SQL"、Cortex 的 "Verified Query Repository"，将 EvalQuestion 从验证副产品演进为 grounding 核心。

## Implementation Decisions

### 架构分层（三层协同）

1. **semanticsHints 层（结构化元数据）**
   - 承载通用语义规则：additivity（NON_ADDITIVE_SUM）、universe scope（TOP-100 vs 全市场）、collapsedDefault（priceBand=整体预汇总）、aggregationGuidance（year 可信性、均价两步法）
   - 存储位置：ObjectType.semantics JSONB 列，通过 renderSemanticsHints 渲染为 Agent-readable hints
   - 新增接口字段：PropertySemantics.aggregationGuidance、aggregationWhitelist.disjointEntities
   - 同步机制：sync-avc-semantics.ts 脚本将 DEF 声明的语义 sync 到 live 租户 + 刷新 matview

2. **Few-shot examples 层（验证驱动 grounding）**
   - 数据源：EvalQuestion 表 (question, baselineTool, baselineArgs, passHistory, question_embedding)
   - 检索策略：余弦相似度检索（HNSW 索引 cosine_ops）+ passHistory >= minPassRate 过滤
   - 生成机制：plan-summarizer back-translate (tool, args) → 中文自然语言 "问题→plan" 对
   - 注入位置：orchestrator.buildSystemPrompt() 在 skills 段之前插入 few-shot 段
   - 缓存策略：后台 cron 每 10 分钟预计算写 Tenant.settings.fewShotCache JSONB，TTL=1h，hot path 仅读缓存（延迟 <10ms）
   - Budget 守卫：estimateTokens 守卫 >900 则降 k=2，>1800 则跳过并记录 alert

3. **Skill prose 层（最小表面）**
   - 仅保留：无法结构化的规则（如"停下来确认参数"）、未积累足够 examples 的边缘规则、工作流描述（四跳决策链整体框架）
   - 压缩策略：删除已下沉到 semanticsHints 的重复描述，改为引用"见 get_ontology_schema(typeName) 的 hints"
   - 目标：从 3537 tokens 压缩至 ~3100 tokens（Phase 2），长期 <2500 tokens

### Phase 1 关键模块

4. **AdditivityGuard 扩展：disjoint brand aggregation whitelist**
   - 问题：当前护栏检查 `sum(value) groupBy [brand]` 时，若 filter 含 `brand IN [小米, 米家]` 且两品牌不重叠，仍被 NON_ADDITIVE_SUM 拒绝（误杀）
   - 解决：在 checkNonAdditive 前新增 isDisjointEntityAggregation() 判断：
     - 提取 filters 中的 brand IN [...]
     - 查询 DB 验证各 brand 的数据行是否 disjoint（无交集）
     - 若 disjoint 且 PropertySemantics.aggregationWhitelist.disjointEntities=true，跳过 NON_ADDITIVE_SUM 检查
   - 涉及模块：AdditivityGuard、PropertySemantics 接口扩展、BRAND_SHARE_DEF 元数据声明

5. **Orchestrator 消息历史修复（BUG-A）**
   - 问题：drill-gate 确认后 resume 时，若原 assistant message 含多个 tool_calls，未处理的 sibling calls 缺 tool_result 导致 DeepSeek API 400 错误
   - 解决：deferUnprocessedSiblings() 逻辑已在 #199 实现，检查是否完整覆盖 resume 路径
   - 涉及模块：orchestrator.service.ts resume() 方法

6. **软预算 punt 消息完整性（BUG-B）**
   - 问题：软预算触发时 synthResult() 返回的 error 消息可能被截断
   - 解决：确保 punt 消息完整写入 toToolResultMsg，不依赖外部 streaming 缓冲
   - 涉及模块：orchestrator.service.ts executeLoop() 软预算分支

### Phase 2 关键模块

7. **SemanticsRenderer 扩展：aggregationGuidance rendering**
   - 新增 renderAggregationGuidance(guidance) 函数：
     - 输入：{field, pattern: 'trust-first-aggregate'|'two-step-ratio', rationale}
     - 输出：`"字段 {field} 聚合纪律：{pattern描述}（{rationale}）"`
   - 集成到 renderSemanticsHints() 主流程，与现有 collapsedDefault/universe hints 并列
   - 涉及模块：semantics-renderer.ts、RenderableSemantics 接口扩展

8. **PlanSummarizer 工具覆盖扩展**
   - 当前仅支持 query_objects/aggregate_objects
   - 新增：semantic_search → `"语义检索 {category} 品类的 {args.query}"`
   - 新增：extract_avc_report → `"导入 AVC {category} {period} 报告"`
   - 简化 args 展示：移除 tenantId，截断超长 filters（保留前 3 个条件 + ellipsis）
   - 涉及模块：plan-summarizer.service.ts summarize() 方法

9. **EvalQuestion 积累自动化**
   - 新增 REST 接口：`POST /evals/questions/batch-capture` — body: {questions: Array<{question, tool, args}>}，批量 capture 降低 OPC friction
   - Schema 扩展：EvalQuestion.metadata JSONB 字段，存储 {questionType: 'fact-query'|'diagnosis'|'cross-year', domainTags: string[], captureSource: 'manual'|'batch'|'auto'}
   - Migration：prisma migrate 生成 AddMetadataToEvalQuestion
   - 涉及模块：evals.controller.ts、evals.service.ts、schema.prisma

### Phase 3 关键模块

10. **EvalQuestionRepository：embedding-based retrieval**
    - 新建深模块封装 EvalQuestion 查询逻辑：
      - `findSimilarVerified(query: string, tenantId, k=5, minPassRate=0.8)` — 余弦相似度检索 + passHistory 过滤
      - `createWithEmbedding(data)` — 调用 EmbeddingClient.embed(question) 后 create
    - Schema 扩展：question_embedding Vector(1024) 列 + HNSW 索引 `CREATE INDEX ON eval_question USING hnsw (question_embedding vector_cosine_ops)`
    - 涉及模块：eval-question.repository.ts（新建）、schema.prisma、EmbeddingClient（复用 Asset B spike 的 Xenova/e5-large）

11. **FewShotGenerator：预计算缓存服务**
    - `precomputeExamples(tenantId, k=3)` — 从 repository 检索 top-k relevant verified questions，调用 plan-summarizer 生成中文 examples，写 Tenant.settings.fewShotCache JSONB
    - `selectExamples(tenantId, k=3)` — 读 fewShotCache，cache miss 时 fallback 空数组并记录 metrics.fewshot_cache_miss_total
    - Cron 定时任务：`@Cron('7 */10 * * * *') precomputeFewShotCache()` — 遍历 active 租户（last_active_at > now() - interval '7 days'）调用 precomputeExamples
    - 涉及模块：few-shot-generator.service.ts（新建）、pipeline.module.ts（注册 cron）

12. **Orchestrator prompt assembly 重构**
    - buildSystemPrompt() 插入 few-shot 段（第 4 段，在 skills 之前）：
      ```
      const examples = await this.fewShotGenerator.selectExamples(tenantId, 3);
      if (examples.length > 0) {
        const examplesText = examples.map((e, i) => `示例${i+1}：${e.question} → ${e.plan}`).join('\n');
        prompt += `\n\n参考以往验证过的正确查询模式：\n${examplesText}`;
      }
      ```
    - estimateTokens 修正中文系数：对中文字符乘 1.8（当前 ÷1.5 低估约 20%）
    - Budget 守卫逻辑：
      ```
      const examplesTokens = estimateTokens(examplesText);
      if (examplesTokens > 1800) {
        log.alert('Few-shot examples exceed budget, skipping');
        // skip examples
      } else if (examplesTokens > 900) {
        // retry with k=2
      }
      ```
    - 涉及模块：orchestrator.service.ts buildSystemPrompt()、FewShotGenerator 注入

### 跨阶段决策

13. **semanticsHints vs prose 边界**
    - **适合下沉到 hints**：字段级通用规则（aggregationGuidance、additivity、universe scope），与具体问题无关
    - **必须留在 prose**：工作流描述（"四跳决策链"整体框架）、停-确认提示（"③④前必须停下来向用户确认参数"）、未积累足够 examples 的边缘规则
    - **灰色地带**：coverage 诚实规则（"先 query avc_report 取 coverage"）— Phase 2 尝试结构化为 ObjectType.metadata.coverageRequirement，Phase 3 若积累足够 examples 则彻底移除 prose

14. **EvalQuestion 覆盖率目标**
    - Phase 2：纯米租户 >=10 条（通过 batch-capture 或 OPC 手动）
    - Phase 3：>=50 条（fact-query >=15、diagnosis >=15、cross-year >=15），覆盖三大问题类型
    - 长期：每垂直 >=100 条，形成"越用越准"飞轮

15. **prompt token 预算分配**
    - 当前（Phase 1 后）：base(400) + guidance(100) + schemaSummary(1200) + tenantProfile(300) + skills(3600) = 5600 tokens（低于 WARN 6000）
    - Phase 2 目标：base(400) + guidance(100) + schemaSummary(1200) + tenantProfile(300) + skills(3100) = 5100 tokens（省 500，为 Phase 3 留裕度）
    - Phase 3 目标：base(400) + guidance(100) + schemaSummary(1200) + tenantProfile(300) + few-shot(600) + skills(2500) = 5100 tokens（skills 持续压缩，few-shot 填补）

## Testing Decisions

### 测试原则

**只测试外部行为，不测实现细节**：
- ✅ 测试：AdditivityGuard.check() 输入 (filter brand IN [x,y], sum value) → 输出 allow/deny
- ❌ 不测：AdditivityGuard 内部的 isDisjointEntityAggregation() 数据库查询逻辑（实现细节）

**深模块优先测试**：封装复杂逻辑且接口稳定的模块优先写单测，浅模块（主要调用其他模块）优先集成测试。

### Phase 1 测试模块

1. **AdditivityGuard（深模块，单测 + 集成测试）**
   - 单测：additivity-guard.spec.ts
     - Case 1: 单品牌 sum(value) → allow（baseline）
     - Case 2: 跨品牌 sum(value) 无 disjoint 声明 → deny（保持现有行为）
     - Case 3: 跨品牌 sum(value) + filter brand IN [小米,米家] + disjointEntities=true + DB 验证 disjoint → allow
     - Case 4: 跨品牌 sum(value) + filter brand IN [小米,小米] + disjointEntities=true + DB 验证 overlap → deny（边界条件）
   - 集成测试：apps/core-api/scripts/test-agent-extended.ts
     - S6: "分析小米和米家在整体市场的份额趋势" → tool calls <10（当前 22）
     - S7: "对比小米和米家在 2024 年各价格段的表现" → tool calls <12（当前 18）

2. **Orchestrator resume 路径（集成测试）**
   - test-agent-extended.ts 增强 drill-gate 场景：
     - 模拟 drill-gate 触发后用户确认，resume 时 assistant message 含 3 个 tool_calls（drill target + 2 siblings）
     - 断言：无 DeepSeek 400 错误，所有 tool_calls 有对应 tool_result

3. **research-qa.skill prose 增强（集成测试，复用现有 harness）**
   - test-agent-extended.ts 覆盖四病修复：
     - S9: priceBand 问题正确路由 brand_share 不误判真空
     - S10: 身份反向用例正确识别 selfBrands 合并
     - S1-S5: year 聚合、均价两步法准确性不退化（baseline 100%）
   - 验收标准：所有 case pass rate >=0.85（与 Phase 1 前基线持平或提升）

### Phase 2 测试模块

4. **SemanticsRenderer（深模块，单测）**
   - semantics-renderer.spec.ts
     - Case 1: renderAggregationGuidance({field:'year', pattern:'trust-first-aggregate', rationale:'ADR-0059...'}) → 返回中文 hint 字符串
     - Case 2: renderSemanticsHints() 输入包含 collapsedDefault + aggregationGuidance → 返回 hints 数组长度 >=2，顺序稳定
   - Prior art: 复用 semantics-renderer 现有测试结构（测 renderCollapsedDefault、renderUniverse）

5. **PlanSummarizer 扩展（单测）**
   - plan-summarizer.service.spec.ts
     - Case 1: summarize(_, 'semantic_search', {category:'电饭煲', query:'用户痛点'}) → 返回 "语义检索电饭煲品类的用户痛点"
     - Case 2: summarize(_, 'aggregate_objects', {filters: [长数组20个条件]}) → 返回截断后的 summary（保留前3个+ellipsis）
   - Prior art: 复用 plan-summarizer.service.spec.ts 现有 case 结构

6. **EvalQuestion batch-capture（集成测试）**
   - evals.controller.spec.ts（或 E2E）
     - Case 1: POST /evals/questions/batch-capture body={questions:[{question,tool,args}×3]} → 返回 201，DB 新增 3 条记录
     - Case 2: 检查 metadata.questionType 自动推断（含"份额"→fact-query，含"为什么"→diagnosis）
   - Prior art: 复用 evals.controller.spec.ts 现有 POST /evals/questions 测试结构

### Phase 3 测试模块

7. **EvalQuestionRepository（深模块，单测 + 集成测试）**
   - eval-question.repository.spec.ts（单测）
     - Case 1: findSimilarVerified(query, _, k=3, minPassRate=0.8) → mock DB 返回 5 条，过滤后返回 3 条（passHistory 前3个 >=0.8）
     - Case 2: createWithEmbedding(data) → mock EmbeddingClient.embed 返回 vector，断言 create 调用包含 question_embedding
   - 集成测试（apps/core-api/scripts/test-eval-question-retrieval.ts，新建）
     - 准备：插入 10 条 EvalQuestion（5 条 fact-query、5 条 diagnosis），生成真实 embeddings
     - Case 1: findSimilarVerified("小米份额趋势", _, 3, 0.8) → 返回 top-3 fact-query 类（余弦相似度降序）
     - Case 2: findSimilarVerified("为什么下滑", _, 3, 0.8) → 返回 top-3 diagnosis 类

8. **FewShotGenerator（深模块，单测 + 集成测试）**
   - few-shot-generator.service.spec.ts（单测）
     - Case 1: precomputeExamples(tenantId, 3) → mock repository 返回 3 条 questions，mock plan-summarizer 返回 summaries，断言写 Tenant.settings.fewShotCache
     - Case 2: selectExamples(tenantId, 3) cache hit → 直接返回缓存，无 DB 查询
     - Case 3: selectExamples(tenantId, 3) cache miss → 返回空数组，记录 metrics.fewshot_cache_miss_total
   - 集成测试（apps/core-api/scripts/test-few-shot-end-to-end.ts，新建）
     - 准备：纯米租户插入 20 条 verified questions
     - 步骤1：手动调用 precomputeExamples，检查 Tenant.settings.fewShotCache 非空
     - 步骤2：调用 orchestrator.buildSystemPrompt，断言返回 prompt 包含 "参考以往验证过的正确查询模式" 段
     - 步骤3：检查 prompt tokens <5500

9. **Orchestrator prompt assembly（集成测试）**
   - test-agent-extended.ts A/B 实验：
     - 准备：纯米租户 EvalQuestion 库 >=30 条（fact-query >=10、diagnosis >=10）
     - Group A（启用 few-shot）：执行 S6/S7/S8 诊断问题，记录 pass rate
     - Group B（禁用 few-shot，通过 feature flag）：执行相同 case，记录 pass rate
     - 断言：Group A pass rate >= Group B + 8%（目标从 ~85% 提升至 >=93%）

### 测试覆盖目标

- Phase 1: AdditivityGuard 单测 4 cases + orchestrator 集成测试 2 cases，总 6 个新增测试
- Phase 2: SemanticsRenderer 单测 2 cases + PlanSummarizer 单测 2 cases + EvalQuestion 集成测试 2 cases，总 6 个新增测试
- Phase 3: EvalQuestionRepository 单测 2 cases + 集成测试 2 cases + FewShotGenerator 单测 3 cases + 集成测试 3 cases + Orchestrator A/B 实验 1 case，总 11 个新增测试
- 总计：23 个新增测试，复用现有 test-agent-extended.ts harness（已有 S1-S10 基线）

## Out of Scope

以下内容明确**不在**本 PRD 范围内，留待后续独立 PRD 处理：

1. **Eval→repair 闭环**（Palantir 的"eval 失败自动触发 prompt 修正"机制）
   - 当前我们只有单向验证（runQuestionNTimes 比对 baseline），未实现"失败后自动诊断并修正 prompt/hints/examples"
   - 原因：需要设计 prompt diff 归因机制（失败是因为 prose 缺失？hints 错误？examples 误导？），复杂度高，独立 epic

2. **多模态 grounding**（图表/表格/文档作为 examples）
   - 当前 few-shot 只注入文本 "问题→plan" 对，未涉及"用户上传 Excel → 正确的 extract_avc_report 调用"等多模态场景
   - 原因：EmbeddingClient 当前只支持文本，扩展到多模态需要 vision model + 新的检索策略

3. **跨租户 EvalQuestion 共享**
   - 当前 EvalQuestion 按 tenantId 隔离，未设计"将纯米的 verified queries 泛化后共享给其他 AVC 租户"机制
   - 原因：涉及 PII 脱敏、ontology label 映射、权限控制，独立 feature

4. **动态 skill 激活**（根据问题自动选择 skill 子集）
   - 当前 skill assembly 由 surface 静态决定（CONSUME→[query,research_qa]），未实现"根据问题动态判断需要哪些 skills"
   - 原因：ADR-0041 明确 skill 由 surface 静态绑定（Conversation 创建时固定），动态激活需要重构 assembleSkills 机制

5. **历史压缩**（buildLlmHistory 动态压缩而非 limit=20 截断）
   - CONTEXT.md 声称有"动态压缩"但代码只做截断，存在矛盾
   - 原因：本 PRD 聚焦 system prompt 生成，历史压缩属于对话管理（conversation.service）独立模块，避免跨域耦合

6. **Prompt caching**（利用 Anthropic/DeepSeek 的 prompt caching 降低成本）
   - 当前每次 chat 重新发送完整 system prompt，未利用 LLM provider 的 caching 机制
   - 原因：需要调研各 provider 的 caching 策略（Anthropic 5min TTL、DeepSeek 未知），设计 cache key 分段（base+schema+hints 高频复用，few-shot 低频变化），独立优化 epic

7. **Tool description 下沉**（将部分 skill prose 移到 tool.description）
   - Workflow critique 提到"可以移到 tool.description"，但未验证 Agent 能否正确理解
   - 原因：需要先跑 A/B 实验验证"prose 在 skill 中 vs 在 tool.description 中"对准确率的影响，Phase 1-3 不做

## Further Notes

### 与现有 ADR 的关系

- **ADR-0033（Accuracy Eval）**：本 PRD 是 Eval 体系的扩展，将 EvalQuestion 从"验证副产品"升级为"grounding 源"，但不改变 N=8 / threshold=0.8 的核心纪律。
- **ADR-0040（单一写入路径）**：AdditivityGuard 扩展保持在单一 TCB（hasCapability → ApplyService → AdditivityGuard），不引入新的权限检查点。
- **ADR-0050（Lazy ontology detail）**：schemaSummary detailBudget=25 不变，aggregationGuidance hints 只在 get_ontology_schema(typeName) 按需返回时显示完整，eager summary 仍保持简洁。
- **ADR-0061（Semantics as first-class metadata）**：aggregationGuidance 是 semantics 体系的自然扩展，复用 renderSemanticsHints 渲染管道。
- **ADR-0062（Open-core vertical）**：本 PRD 提升的是 **platform 能力**（所有 vertical 共享），不绑定 AVC。未来新 vertical（如财报、供应链）接入时，只需声明自己的 semantics + 积累 verified queries，无需修改 orchestrator 核心逻辑。

### 风险与缓解

**风险 1：Phase 3 embedding 检索召回率不足**
- 表现：findSimilarVerified 返回的 examples 与当前问题结构不相关，few-shot 反而误导 Agent
- 缓解：
  - Phase 2 先积累 >=50 条 questions 覆盖三类型（fact-query/diagnosis/cross-year），保证库质量
  - A/B 实验验证 few-shot 提升（Group A vs Group B），若提升 <5% 则暂停 Phase 3 rollout，优先扩充库
  - 设置 fewshot_cache_hit_rate alert（<60% 触发），及时发现检索失效

**风险 2：跨品牌 disjoint 判断误判（BUG-A 的对偶）**
- 表现：isDisjointEntityAggregation() 误判两品牌 disjoint，实际数据有交集，sum 得到错误结果
- 缓解：
  - 白名单机制保守：只在 PropertySemantics 显式声明 disjointEntities=true 时启用（当前只有 BRAND_SHARE value 字段）
  - DB 验证查询：`SELECT COUNT(*) FROM (SELECT brand FROM ... WHERE brand IN [x,y] GROUP BY brand HAVING COUNT(DISTINCT brand) < 2)` 确认真正 disjoint
  - test-agent-extended.ts 增加边界 case（S6-overlap: "分析小米和小米手机"，期望 deny 或一次查询）

**风险 3：prompt token 预算超预期（Phase 3 few-shot 膨胀）**
- 表现：注入 k=3 examples 后 estimateTokens > 6000 触发 WARN，逼近 ERROR 8000
- 缓解：
  - 严格 budget 守卫：>900 降 k=2，>1800 跳过，保证核心 prompt 不受影响
  - plan-summarizer 简化：截断超长 filters/groupBy，移除 tenantId，控制单条 example <200 tokens
  - Grafana alert：fewshot_token_budget_skip_count 日增 >10 触发，说明 examples 过长需优化

**风险 4：纯米 live 租户 schema migration 失败**
- 表现：Phase 2/3 的 prisma migrate（metadata 列、question_embedding 列）应用到生产租户时失败或锁表
- 缓解：
  - Phase 2 migration（metadata Json @default("{}")）是 nullable + default，zero-downtime
  - Phase 3 migration（question_embedding Vector(1024)）先在 staging 租户验证，确认 pg_vector extension 已安装
  - 使用 online schema change 工具（如 pgroll / pg-osc）避免长时间锁表

### 成功指标（分阶段）

**Phase 1（1-2周后）**
- ✅ S6/S7 宽问题 tool calls 从 22 → <10（-55%）
- ✅ test-agent-extended.ts 所有 case 无 DeepSeek 400 错误、无半截 punt
- ✅ S9 priceBand 问题不误判真空，S10 身份反向用例正确合并
- ✅ prompt tokens <4000（低于 WARN 6000 留 50%+ 裕度）

**Phase 2（2-4周后）**
- ✅ research-qa.skill prose 从 3537 tokens → ~3100 tokens（-12%）
- ✅ get_ontology_schema(market_metric) 返回包含 year/avgPrice 的 aggregationGuidance hints
- ✅ 纯米租户 EvalQuestion 库 >=10 条，metadata.questionType 正确标注
- ✅ 准确性不退化（test-agent-extended.ts pass rate >=0.85）

**Phase 3（长期）**
- ✅ 复杂诊断问题 pass rate 从 ~85% → >=93%（+8%）
- ✅ fewshot_cache_hit_rate >80%（说明 cron 预计算生效）
- ✅ P95 executeTurn 延迟增量 <50ms（few-shot 注入无用户感知）
- ✅ 纯米租户 EvalQuestion 库 >=50 条（三类型均衡覆盖）
- ✅ prompt tokens <5500（低于 WARN 6000 留 >8% 裕度）

### 长期愿景（6-12个月）

对标 Palantir AIP Evals，将 OPC 从"Prompt 工程师"解放出来，形成**数据飞轮**：
1. OPC 日常使用 → 审查答案 → 批量 capture verified queries
2. 系统自动 embedding 索引 → cron 预计算 few-shot cache
3. 新问题自动检索相似 pattern → grounding 推理 → 准确率提升
4. 更多正确答案 → 更多 verified queries → 库持续增长 → 准确率持续提升

终态三层协同：
- **semanticsHints**：字段级通用规则，与问题无关（如"year 可信"）
- **Few-shot examples**：问题→plan 模式，动态检索注入（如"份额趋势类问题用 groupBy[period]"）
- **Skill prose**：最小表面，仅保留无法结构化/未积累 examples 的边缘规则（目标 <2500 tokens）

届时新垂直接入成本降至：声明 semantics（1 day）+ 积累 50 条 verified queries（2 weeks），无需编写大量 prose。
