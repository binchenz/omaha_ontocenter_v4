# ADR-0047: DeepSeek V4 Migration & Agent-Driven Chart Visualization

## Status

Accepted (2026-06-07)

## Context

Two forces converge:

1. **Model deprecation deadline.** DeepSeek will retire `deepseek-chat` and `deepseek-reasoner` on 2026-07-24. The replacement models are `deepseek-v4-flash` (fast/cheap) and `deepseek-v4-pro` (strong/reasoning). Both support a new `thinking` mode and `strict` tool calling (server-side JSON Schema validation).

2. **Visualization gap.** The AVC market intelligence pipeline is complete (upload → parse → ingest → query), but results render as raw JSON tables. Brand managers need charts — trend lines, share comparisons, price-band matrices — to act on insights. This is the last mile for pilot deployment.

## Decisions

### 1. Model selection: per-Skill routing

| Skill | Model | Thinking | Rationale |
|-------|-------|----------|-----------|
| `data-ingestion` | `deepseek-v4-flash` | disabled | Simple tool routing, file parsing — speed matters more than reasoning depth |
| `research-qa` | `deepseek-v4-pro` | enabled (effort=high) | Four-hop decision chain requires multi-step reasoning; accuracy is the core paid value |
| All others (default) | `deepseek-v4-flash` | disabled | Cost-effective for CRUD operations |

Implementation: `LlmOptions` gains `model?: string` and `thinking?: { type: 'enabled' | 'disabled' }` + `reasoningEffort?: 'high' | 'max'`. Skills pass these through to the LLM client.

### 2. Base URL: unified beta + strict mode

All tools migrate to `strict: true` with `base_url = https://api.deepseek.com/beta`. Every tool's JSON Schema must have `additionalProperties: false` on all object nodes and all properties listed in `required`.

Rationale: strict mode guarantees well-formed tool call arguments at the API level, eliminating a class of runtime parse failures. Prior axis-A experiments (ADR-0026) confirmed schema constraints improve tool call accuracy.

Risk: beta endpoint availability. Mitigation: ResilientLlmClient already retries on 5xx; if beta proves unstable, fallback to stable endpoint is a one-line config change.

### 3. Thinking mode: reasoning_content round-trip

When thinking is enabled, the Agent loop must:
- Preserve `reasoning_content` on assistant messages between tool calls within the same user turn
- Pass it back to the API on subsequent requests in that turn
- Discard it across user turns (per DeepSeek docs — ignored by API anyway)

`LlmMessage` interface gains `reasoning_content?: string`. The DeepSeek client reads it from responses and includes it in subsequent request messages.

### 4. Visualization: `render_chart` as a strict tool

Chart rendering is Agent-driven (not a standalone dashboard). The Agent decides when and what to visualize based on query context.

**Tool type:** Real tool, non-terminal. Backend handler transparently returns `{ rendered: true, chartId }`. Agent continues with textual summary after chart emission.

**Chart spec format:** Inline data (Agent passes aggregated data points directly). Data volumes are small (market analysis = tens of data points per series). Large datasets (> 500 rows) should use ResultTable instead.

**Supported chart types (12):**

| Type | Use case |
|------|----------|
| `line` | Time-series trends |
| `bar` | Rankings, comparisons |
| `stacked_bar` | Composition/share breakdown |
| `grouped_bar` | Multi-dimension comparison |
| `pie` | Proportional distribution |
| `area` | Trend with volume emphasis |
| `stacked_area` | Composition change over time |
| `scatter` | Correlation (price vs volume) |
| `heatmap` | Matrix cross-tab (brand × price-band) |
| `kpi` | Key metrics (market size, growth rate) |
| `waterfall` | Incremental decomposition |
| `radar` | Multi-axis competitiveness |

**Frontend:** recharts library + `ChartRenderer` component that dispatches on `type`. Reads chart spec from `ConversationTurn.tool_calls` where `tool.name === 'render_chart'`.

### 5. Implementation layers (dependency order)

```
Layer 1: Model migration + thinking + strict (backend, deadline 7/24)
  ├─ deepseek-llm-client.ts: base_url, model routing, thinking params
  ├─ llm-client.interface.ts: LlmOptions + LlmMessage extensions
  ├─ Agent loop: reasoning_content preservation
  └─ All existing tools: strict: true + additionalProperties: false
         ↓
Layer 2: render_chart tool (backend)
  ├─ Tool schema (strict, 12-type enum)
  ├─ Handler (pass-through + chartId)
  └─ research-qa skill prompt update
         ↓
Layer 3: Frontend chart rendering
  ├─ recharts installation
  ├─ ChartRenderer dispatcher component
  ├─ 12 chart sub-components
  └─ MessageList integration
```

## Alternatives Considered

| Alternative | Why rejected |
|-------------|-------------|
| Single model for all skills | research-qa needs reasoning depth; flash is insufficient for four-hop chains |
| Markdown code block for charts (`\`\`\`chart`) | No schema validation; requires frontend regex parsing; fragile |
| Terminal tool (render_chart ends the turn) | Agent can't add textual summary after chart — loses the "so what" insight |
| Query reference instead of inline data | Adds frontend complexity (second API call), breaks offline viewing, unnecessary for small aggregated datasets |
| Separate dashboard page (not agent-driven) | Loses core differentiator (agent-first UX); defers to v0.2 |
| Stable endpoint + selective beta | Maintaining two base URLs adds complexity; strict benefits all tools |

## Consequences

- `deepseek-chat` dependency eliminated before 7/24 deadline.
- Tool call reliability improves across the board (strict validation).
- research-qa reasoning quality improves (thinking mode + stronger model).
- Brand managers see charts inline in conversation — the "upload → insight" journey is complete.
- Token cost increases for research-qa turns (~2x due to thinking + pro pricing). Acceptable given low call frequency (tens/day per tenant).
- Frontend gains a chart rendering system reusable beyond market intelligence (any future tool can emit charts).
- No LLM fallback provider — same rationale as ADR-0046 (maintaining dual compatibility costs more than occasional downtime).
