# 语义标注范式：description 编码刻度 + 导航句 + 兄弟字段边界

为 drama_co 小说本体补语义标注时，确立了一套 `description` 写法范式。本体里存在多组高碰撞字段——三个"张力"字段同刻度不同粒度、两套评分不同刻度、节奏密度 vs 情感张力——光靠字段名和 label，喂给 LLM 的 schema summary 无法区分。范式如下：

1. **description 显式写出数值刻度**（0-10 / 0-100 / 0-1）。刻度全部经源库真实数据核验，不臆测：`overall_score`/`adaptation_score` 是 0-10，`market_overall`/`MarketScore.score` 是 0-100，`emotionalTone`/`avg_tension`/曲线 `value` 同为 0-100，`pacingDensity`/`data_completeness` 是 0-1。
2. **加"找 X 用此字段"导航句**，直接把自然语言意图映射到字段（如"找最紧张的一章用 emotionalTone"）。
3. **点明与兄弟字段的区别**，让 description 互相划界（如 avg_tension 标注里明确"要找某一章请用 emotionalTone"）。

## 为什么

语义层（schema summary 注入，见 core-sdk.service.ts:getSchemaSummary）只把 `name:type✓↕[unit] — description` 喂给 LLM。当多个字段类型相同、名字相近时，唯一能消歧的信号就是 description 和 unit。复述 label 式的 description（"平均张力"）毫无消歧价值；编码了刻度、用途、边界的 description 才能让 LLM 在 `avg_tension` / `emotionalTone` / `value` 之间选对。

## 这不是完整复活 drama_co

源库 (`short_play_snail_data`) 的小说数据已基本清空，无法真跑 ingest 验证。因此本次只交付**带标注的本体** (`scripts/drama-co/ontology.ts`) + 接入/验证 runbook (`scripts/drama-co/README.md`)，不恢复 source-reader/recipes/编排的可运行接入，也不改动已作废的 deployment.md。与 ADR-0022 的"drama_co 已退役"一致——这是标注参考样本的复活，不是客户交付的复活。

## 适用范围

该范式适用于所有本体的标注设计，不限 drama_co。demo-drama 路径①的手写标注、DataIngestionSkill 的自动推断（cdd6736），都应产出符合此范式的 description——尤其是当本体内存在同刻度不同粒度、或同名不同刻度的字段时。
