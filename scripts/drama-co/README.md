# drama_co 小说本体 — 接入与消歧验证 Runbook

> 状态：**代码侧已就绪，数据侧待补**。截至 2026-05-29，可触达的源库
> (`short_play_snail_data`) 中小说分析数据已基本清空（0 行 uploaded_books，
> 仅 1 行 novel_metadata + 190 行悬空 chapter_summaries）。本 runbook 描述
> 当完整源数据恢复后如何接入并验证语义层消歧。详见 ADR-0023。

## 这份交付包含什么

- `ontology.ts` — 带完整语义标注（60 description + 15 unit）的小说本体，刻度经真实数据核验。**这是本次工作的核心产物，已就绪可用。**
- 本 runbook — ingest 与消歧验证步骤。

## 尚未恢复的接入代码

以下文件在开源清理 (c5d2e84) 中删除，需从 git 历史 `c5d2e84~1` 恢复后才能跑 ingest：

```bash
git show c5d2e84~1:scripts/lib/film-ai-v2-source-reader.ts   > scripts/drama-co/source-reader.ts
git show c5d2e84~1:scripts/lib/film-ai-v2-recipes.ts         > scripts/drama-co/recipes.ts
git show c5d2e84~1:scripts/import-film-ai-v2.ts              > scripts/drama-co/import.ts
```

恢复后需改两处（因源库已变迁）：
1. 三个文件顶部的 ontology import 路径改指向 `./ontology`
2. **source-reader 的 SQL 需对齐当前库 schema** —— 已知漂移：`market_comparison` 列不存在（改读 `market_potential->>'comparison'`）；若数据在 `source_type='novel_metadata'` 而非 `'uploaded'`，需放宽 WHERE 条件。

## 接入步骤（数据恢复后执行）

```bash
# 1. 确认源库连通 + 有数据
#    连接串含库凭据，从安全渠道获取，勿写入仓库
psql "$DRAMA_SOURCE_URL" -c "SELECT count(*) FROM uploaded_books"   # 应 > 0

# 2. 建租户 + 灌本体（带标注）
cd scripts
pnpm tsx drama-co/setup.ts     # 待补：仿 demo-drama/setup.ts，import ./ontology

# 3. 跑 ingest（IngestRecipe + runRecipe，遵循 ADR-0016）
DRAMA_SOURCE_URL="postgresql://..." pnpm tsx drama-co/import.ts

# 4. 刷新物化视图
#    setup 中对每个 objectType 调 viewManager.refresh
```

## 消歧验证（核心目的）

接入后，用这些**故意歧义**的查询验证语义标注是否让 LLM 正确选字段。
开 `LLM_DEBUG=1` 跑，对照 `.llm-debug/*.json` 看 LLM 实际选了哪个字段。

| 查询 | 期望命中字段 | 验证的标注 |
|------|------------|-----------|
| "张力最高的是哪一章" | `ChapterSummary.emotionalTone` | 章级张力 vs 书级/曲线 |
| "哪本书整体张力最强" | `Book.avg_tension` | 书级均值，非章级 |
| "张力曲线的峰值在哪" | `EmotionalCurvePoint.value` | 曲线采样点 |
| "评分最高的书" | 需追问或同时给 `overall_score`(0-10) 与 `market_overall`(0-100) | 双评分刻度歧义 |
| "最适合改编的书" | `Book.adaptation_score` | 改编分导航句 |
| "市场前景最好的书" | `Book.market_overall` | 市场分 vs 内容质量分 |
| "节奏最紧凑的章节" | `ChapterSummary.pacingDensity` | 节奏密度 vs 情感张力 |
| "故事中点发生了什么" | `PlotBeat` where `pct≈50` | pct 是 0-100 百分比 |

**判定标准**：上述查询中，标注前 LLM 在张力三字段、双评分上几乎必然混淆；标注后应能依据 description 的刻度说明 + 导航句正确选字段。这就是语义层的价值证明。
