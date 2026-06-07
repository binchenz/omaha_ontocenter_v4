---
status: accepted
amends: 0042
---

# Market-intelligence ontology amendment: model-metric star, coverage-per-report, dynamic band attribution, new-entrant as derived

## Context

After the first AVC data was ingested and the live demo was attempted, the domain owner identified a gap: the ADR-0042 ontology is **data-first, not decision-first**. It mirrors two AVC sheets (2-1 and 2-5) and stops there. The decision chain that justifies buying market-monitoring data is four hops:

> ① 近3个月小米电饭煲和其他厂家比销量趋势  
> ② 市场份额有没有下滑  
> ③ 是哪个价格区间段的商品出了问题  
> ④ 是不是其他厂家在某个价格区间段出了新品抢了市场

Hop ③ requires drilling from a brand-level share movement to the price band that moved. Hop ④ requires drilling further to the specific SKU that entered that band and gained share, and reading its launch date to distinguish a new entrant from an incumbent. The ADR-0042 ontology (market_metric + brand_share) cannot answer ③ or ④ at all.

A full audit of the archive revealed the data already exists: full-variant AVC reports (数据报告, 32 sheets) carry sheet **2-7 TOP机型明细** — one row per TOP-100 SKU, with columns for 机型, 品牌, 加热方式, 上市日期, 预约功能, **monthly 销额份额/销量份额 for the last 4 months**, and **月零售均价**. This is a complete single-SKU time series, inside one report, requiring no cross-report stitching for near-term trends.

Three structural decisions fell out of the audit and a design grilling:

1. **Sampling universe mismatch**: brand_share (2-5) is computed against the whole market by AVC; 2-7's TOP-100 per-model figures sum to less than 100% (the long tail is out). Re-deriving brand share by summing model rows produces a number that does not match the AVC figure and cannot be cited with AVC's provenance. The two sheets are therefore irreducibly different fact sources.
2. **Coverage flips over time**: 养生壶/空气炸锅/料理机 etc. were full-variant at 22.12–23.12 but dropped to essence-variant (精华版, 10 sheets, no model layer) from 24.12 onward. Coverage is not a stable property of a category.
3. **Price-band segmentation is category-specific**: AVC's 电饭煲 bands (＜100/100-119/120-139/…) are completely different from 净水器 bands. The parsePriceBand design (ADR-0042 context) deliberately does not reconcile to a canonical set. A model's 零售均价 is a continuous value; its membership in a band is a query-time predicate, not a stored label.

## Decision

### 1. Add `model_metric` as a third star object (amends ADR-0042 decision 2)

The star objects are now three:

| Object | Source sheet | Grain | Time dimension |
|---|---|---|---|
| `market_metric` | 2-1 | 品类 × 指标 | months across columns |
| `brand_share` | 2-5 | 品类 × 品牌 × 价格段 | one snapshot per report; trend by stacking periods |
| `model_metric` | 2-7 | 品类 × 机型 × 品牌 | 4 months within one report (no cross-report needed for near-term) |

`model_metric` carries: 机型 (SKU code), 品牌, 加热方式, 上市日期, 预约功能, 月份, 销额份额, 销量份额, 零售均价.

**Three-star coexistence, not single-source derivation.** brand_share is NOT derived from model_metric aggregation (sampling universes differ; doing so breaks provenance). Each star binds directly to its own AVC sheet; aggregation happens at query time, not at ingest.

Rejected — **model_metric as the sole fact source, brand/band shares derived**: 2-7 is a TOP-100 sample; AVC's 2-5 is whole-market. Summing TOP-100 rows yields a number that does not match AVC's figure and cannot be cited as AVC-authoritative.

### 2. Coverage is per-report (品类 × 月), not per-category (amends ADR-0042 decision 4 scope)

Coverage (full | essence) is stamped on each report's provenance row at ingest, not on the category. The extractor detects the variant by checking whether sheet 2-7 is present (file name containing "精华版" is a reliable secondary signal).

The Agent uses the provenance coverage flag to respond honestly: for an essence-period query on 空气炸锅, it says "this period has brand-level data only; model-level drill requires an earlier full period" — preventing a hallucinated SKU answer. Reading 0 model rows is ambiguous (gap vs real-zero); the explicit flag resolves it.

Rejected — **per-category coverage flag**: 空气炸锅 was full at 22.12–23.12 and essence from 24.12; a category-level flag would lie for one of those periods.

### 3. Price-band attribution is a query-time interval predicate, not a stored label on model_metric (refines ADR-0042 §"no canonical band set")

`model_metric` stores **零售均价 as a continuous numeric value**. To answer "which SKU in the 180-199 band fell," the query filters `均价 >= 180 AND 均价 < 199` — the interval comes from the brand_share side, not from a label pre-assigned to the model row. This is the natural extension of parsePriceBand's `[min, max)` design: a band is an interval, a price is a point, membership is a predicate.

Rejected — **pre-bucketing models into a canonical price-band label at ingest**: 净水器 and 电饭煲 use incompatible AVC band cuts; any canonical set would mis-categorize one or the other. The dynamic predicate avoids the problem entirely.

### 4. "New entrant" is a derived judgement over `上市日期`, not a stored object (no sheet 2-9 extraction)

A model is a new entrant for a query's time window when `上市日期 ∈ [报告月 − N, 报告月]` (N tunable at query time). Sheet 2-9 (本期新品机型明细) is **not extracted** — its information is a strict subset of 2-7's model rows filtered by a recent 上市日期, and AVC's own "new this period" window is undocumented and therefore not explainable.

Requirement ④ is then a single-object query over model_metric: `上市日期 ∈ last-N AND 均价 ∈ band-interval AND share rising` — no join to a separate new-product object.

Rejected — **separate `new_model` object or stored `isNewThisPeriod` flag**: stores a derived fact (violating the Derived Property principle), depends on 2-9 which is absent in essence variants, and uses an opaque AVC window definition.

## Acceptance test (supersedes ADR-0042's two-part fused query)

A single turn answering the four-hop chain:

1. "小米 电饭煲 近3个月销量趋势 vs 主要品牌" → model_metric aggregated by brand, last 3 months
2. "市场份额下滑" → brand_share trend across stacked periods
3. "哪个价格段" → brand_share 价格段列 showing the declining segment, then model_metric filtered by that segment's interval
4. "是不是竞品出新品抢的" → model_metric WHERE 上市日期 in last-N AND 均价 in segment AND share-trend ascending

Each hop cites its AVC source sheet and report period. No hop produces an answer the data cannot support.

## Consequences

- **extractor must be extended to parse 2-7** (multi-row header grid: 序号|机型|品牌|{加热方式,上市日期,预约}|{月销额份额×4}|{月销量份额×4}|{月均价×4}|{本年累计×2,均价}). This is additive — 2-1 and 2-5 extraction is unchanged.
- **brand_share period bug must be fixed**: current extractor hardcodes `period = "本期市场"`. It must read the report's cover month (sheet 封面, or extracted from the filename pattern `avc-YY_MM`) and stamp it on each brand_share row so stacked periods produce a real trend.
- **Coverage flag added to provenance row at ingest**: one field, detected by sheet-presence check.
- **No 2-9 extraction**: sheet is skipped; its information is recoverable from 2-7 + 上市日期 filter.
- **essence-variant categories (空气炸锅/养生壶/料理机/煎烤机/电水壶 from 24.12+) cannot answer hops ③–④** for recent periods. The Agent must acknowledge this; it is not a bug but a data-coverage gap the domain owner accepts.
- **The four-hop acceptance test is the new v1 gate.** The two-part fused query in ADR-0042 remains as the minimum floor; the four-hop chain is the target.
