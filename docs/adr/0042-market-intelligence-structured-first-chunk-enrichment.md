---
status: accepted
---

# Market-intelligence application: structured-first spine, chunk as enrichment, document as provenance

## Context

A prospect (纯米科技, a Xiaomi-ecosystem small-appliance maker) asked whether the platform solves a problem that is *not* the SMB-commerce MVP it was built for: they spend heavily every quarter on market research and industry monitoring, and the output — Excel data, PDF/PPT/Word reports — is "expensive to produce and barely used," scattered across files no one can query as a whole. This is the first real demand to apply an *ontology-native query platform* to *market intelligence over a research archive*, and it forces a decision the SMB-commerce ADRs never had to make: how unstructured documents relate to the structured ontology.

A walk through a real sample of their archive (`调研及市场数据/`) established the data reality, which is the load-bearing context:

1. **The archive is two categorically different assets, needing two different machines.**
   - **Asset A — AVC (奥维云网) monthly market monitoring.** One file per appliance category (电饭煲, 空气炸锅, 净水器, …), one issue per month, structurally identical across a multi-year span (22.12 → 26.04). It is the platform's natural strength's natural input — except the xlsx is **not clean tabular data**. It is a heavy analyst cross-tab: multi-row headers, section titles interleaved with data rows (data starts ~row 6), months pivoted into columns, brand×price-band two-dimensional grids, and merge ranges in the hundreds-to-thousands per sheet (one sheet: 3194 merged ranges). The existing `FileParserService` (first sheet, first row = header, sample 20 rows) yields garbage on it.
   - **Asset B — qualitative/quantitative research reports (PDF, 33–128 pp).** Narrative findings, TOP-5 preference rankings, and verbatim user quotes ("喜欢 COLMO 的科技感,希望显示屏大一些" — 成都倪先生). Embedded data tables exist but extract as an unstructured wall of numbers that cannot be reliably reconstructed into tables.

2. **The two assets share a clean categorical spine: `品类` (category), declared at ingest, with `价格段` (price band) as a shared sub-axis inside both** (the PDF research and the AVC monitoring both segment by the same `≤199 / 200-399 / 400-699 / …` bands). The connection between a narrative finding and a market number does **not** require entity extraction from prose — it is a classification value an OPC declares when ingesting the file.

3. **The highest-value PM workflow fuses both.** "Xiaomi's share in 400-699 is dropping (a number from A) — *why? what do users say?* (narrative + quote from B)." A plain BI dashboard answers only the first half; a plain RAG tool answers only the second. The fused answer — number + narrative + provenance on one `品类×价格段` spine — is the platform's differentiator over both, and the thing the prospect cannot get from any tool they already own.

This ADR records what to build *first* for this class of use case, and the data-model shape that keeps it ontology-native rather than degenerating into a searchable document store. It does **not** require an architectural change: the platform's ObjectType/Property/Relationship + JSONB-row model already has the right shape to hold the structured insight objects, and Asset B's one genuinely new capability (vector retrieval) lands inside Postgres via `pgvector`, preserving the single-substrate constraint ADR-0040 chose.

## Decision

### 1. First deliverable = Asset A in full + a minimal slice of Asset B (not A-only, not B-first)

The v1 for a market-intelligence engagement is **all of Asset A** (the AVC time-series, end to end through the existing query engine) plus a **deliberately minimal slice of Asset B** — a handful of research PDFs run through chunk + embed + retrieval, with quality intentionally un-polished. The minimal-B slice exists for exactly one reason: **v1 must be able to demo one fused query** (decision context §3). A-only would land as "a chatbot over a market dashboard" and, to a customer who paid for *insight*, read as "data without the why" — forfeiting the only differentiator. B-first would land a generic RAG tool with no differentiated spine yet built. So: A is made solid (it is the spine; chunks hang on it), B is made just-real-enough to light up the fusion.

Rejected — **A-only v1**: forfeits the fusion demo, the one thing competitors can't match. Rejected — **B-first**: the first milestone is then an undifferentiated document-search tool, because the structured spine that makes fusion possible (A) doesn't exist yet. The ordering is asymmetric: A-first ships a complete, differentiated product *and* builds B's spine in passing; B-first ships an undifferentiated tool and only becomes differentiated once A also lands.

### 2. The star objects are structured insight objects; the document is **provenance**, never the object

Following Palantir's own ontology design principle — *"if the sole purpose is analysis, the data can probably stay in datasets"*; objects must bear decisions/actions and form natural-language sentences — a "report" or "document" is **not** an Object Type. Modelling `Report` as a first-class object is the failure mode that degenerates the ontology into a document-management system. Instead:

- **Asset A becomes the star Object Types** (market metrics: retail value / volume / price / share, as a monthly time series per category and price band). These are decision-bearing, aggregatable, queryable — the platform's existing strength.
- **The raw files (PDF/xlsx) are media, addressed by reference** (the platform gains a blob store + a lightweight provenance object carrying `品类 / 机构 / 季度` + a media reference + page anchor), exactly as Palantir keeps documents in a media set and lets objects point at them. Provenance ("据艾瑞 2025Q2 报告第 14 页") is a **correctness floor**, not a feature: a finding the PM cannot trace and open is a finding they won't trust.
- **Asset B's narrative chunks are an enrichment layer hung on the category spine**, not the headline. A `Chunk` (text + embedding + media-reference + page) is enrichment that lets a query about a category surface the relevant narrative and quote alongside the numbers — blood on the skeleton, not the skeleton.

### 3. The structured↔narrative link is the declared `品类` spine — **no entity extraction (NER) in this scope**

A chunk associates to the structured insight objects via the **`品类` (and where present, `价格段`) declared at ingest** — a clean classification value, not a name extracted from prose. We explicitly **do not** build NER / entity-resolution to link "空气炸锅" mentioned in a PPT to an 空气炸锅 metric object. Three reasons: (a) the structured data the narrative would link *to* is the research archive itself, sharing the same declared category — so the cheap, reliable join already exists; (b) NER on Chinese long-form reports is a trust killer (a wrong auto-link presented as fact destroys the provenance guarantee decision 2 is built on); (c) Palantir's flagship Chunk→Entity→knowledge-graph workflow solves *cross-document fine-grained linking against operational data* — which is not this engagement (the prospect's operational/sales data is not in the platform, and may never be). The NER/knowledge-graph layer is named for later and is a clean superset: it adds entity extraction *on top of* the Chunks decision 2 already lands, with no rework.

### 4. Asset A's extractor is a bounded template adapter, **not** a reason to fast-track the general Pipeline plane

The AVC cross-tab is not clean tabular data (context §1), so it cannot ride the existing `ImportEngine`/`FileParserService` path. But it is **template-fixed and periodic**, which makes it the opposite of the general data-quality problem ADR-0040's Pipeline plane exists for: a known fixed layout is trivially parseable by a **template-aware extractor**, and because the same template recurs every month, that extractor's cost amortizes across an ongoing **data feed** (not a one-shot import). So Asset A is built as a **specialized Connector/extractor for a known template** (it must handle the 2 known AVC variants — the full `数据报告` and the `综合分析精华版` that appears from 24.12 — a bounded, not open, set), producing clean rows that flow through the normal Object Instance path. This is explicitly **not** a trigger to build ADR-0040's general cross-tab cleaning engine; conflating "parse this known template" with "clean arbitrary analyst spreadsheets" would over-build the v1 by an order of magnitude.

### 5. Document ingestion's confirmation point moves to the document level

Conversational structured ingestion (ADR-0009) confirms an inferred schema **field by field**. Documents cannot: no one confirms 500 chunks. The confirmation point for Asset B moves **up to the document level** — the OPC/Agent confirms the document's classification metadata ("this is 艾瑞 2025Q2 空气炸锅, 品类=厨房小电"), while chunking + embedding run automatically without per-chunk confirmation. This is a deliberately different interaction model from tabular ingestion and is fixed here so it isn't rediscovered per-skill.

## Considered Options

- **A-only v1** — rejected (decision 1): forfeits the fused-query demo, the sole differentiator over BI/RAG tools.
- **B-first** — rejected (decision 1): first milestone is an undifferentiated document-search tool; differentiation waits on A regardless.
- **`Report`/`Document` as a first-class Object Type** — rejected (decision 2): violates Palantir's "analysis-only data stays in datasets / objects bear decisions" principle; degenerates the ontology into a document store. Documents are media + provenance.
- **NER / Chunk→Entity knowledge graph for the structured↔narrative link** — rejected for this scope (decision 3): the reliable declared-`品类` join already exists, NER on Chinese reports is a trust risk, and the knowledge-graph layer solves a cross-document/operational-data problem this engagement doesn't have. Named for later as a clean superset.
- **Fast-track ADR-0040's general Pipeline cleaning engine to handle the AVC cross-tab** — rejected (decision 4): the AVC layout is template-fixed and periodic, so a bounded template adapter is the right altitude; the general engine is for arbitrary dirty spreadsheets, an order of magnitude more work than v1 needs.
- **A second storage substrate (object store / external vector DB) for documents + embeddings** — rejected (consistent with ADR-0040 decision 2): `pgvector` keeps vector storage and nearest-neighbour search inside the existing Postgres, fitting the 10⁴–10⁶-row single-OPC scale without importing Foundry-scale heaviness.

## Consequences

- **One genuinely new capability axis (Asset B), landing on existing seams where possible.** New: a blob/media store (today only ephemeral `uploads/` exists), document text extraction (today `FileParserService` is CSV/Excel only), chunk + embedding generation (an embedding-API call), a `pgvector` column + nearest-neighbour read path, and a `research_qa` Skill on the consume surface (ADR-0041). The query *interface* and the Skill/Surface/Agent model (ADR-0039/0041) are reused unchanged; the new retrieval is a new read path, not a new query language.
- **Asset A is additive on the existing Object Instance + query path** — the only new piece is the template-aware extractor (decision 4); the resulting metrics are ordinary Object Instances queried by the existing engine.
- **The category spine is the contract between the two assets** — `品类` (and `价格段`) declared at ingest is what makes a fused query work without NER (decision 3). This is the single coupling point; both ingestion paths must agree on the category vocabulary.
- **The fused query is the acceptance test for v1**, not a stretch goal: a single turn answering "share in 400-699 is dropping — why, what do users say" with number + narrative + traceable provenance. If v1 cannot demo this once, the minimal-B slice (decision 1) was cut too thin.
- **AVC does not cover new product forms** (e.g. 分体式电饭煲 exists only in a qualitative PDF) — so Asset B carries independent value Asset A structurally cannot, reinforcing that B is named-for-near-term, not optional-someday.
- **No CONTEXT.md / schema terms are added yet.** The domain terms this implies (the market-metric Object Types, `Chunk`, the provenance object, the category spine) are forward-looking; per the project's lazy-documentation discipline they land in CONTEXT.md and the Prisma schema when implemented, not on the strength of this decision alone. This ADR is the *what-and-why-first*; the PRD/issues that implement it will resolve the concrete object names and storage.
- **Relationship to the SMB-commerce MVP:** this is a *second application class* of the same platform, not a pivot. It validates the ontology-native bet on a domain it wasn't designed for, and every reused seam (Object Instances, NL query, Surface/Skill/Agent, single-substrate Postgres) is evidence the architecture generalizes. The deferred NER/knowledge-graph layer (decision 3) is where this class would, much later, converge toward Palantir's full document-intelligence shape.
