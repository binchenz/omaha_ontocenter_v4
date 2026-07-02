# SSE Extractors — Implementation Summary

## Overview

Generic and specific SSE event extractors for parsing Agent responses in the Ontology Ground Truth harness. Follows patterns from `delivery-report/scenario-judges.ts` with enhanced type safety and graceful error handling.

## Files

- **`sse-extractors.ts`** — Core implementation (273 lines)
- **`sse-extractors.unit.spec.ts`** — Jest unit tests (479 lines, 35 test cases)
- **`verify-sse-extractors.js`** — Node.js verification script (8 tests, all passing)

## API

### Generic Extractor

```typescript
function extractToolResult<T>(events: SseEvent[], toolName: string): T | null
```

Finds the first `tool_result` event matching `toolName` and returns its typed data field. Returns `null` for missing/malformed events.

**Example:**
```typescript
const result = extractToolResult<{result: {value: number}}>(events, 'query_metric');
if (result) console.log(result.result.value);
```

### Specific Extractors

#### 1. `extractQueryValue`

```typescript
function extractQueryValue(events: SseEvent[]): number | null
```

Extracts numeric value from `query_metric` tool result (ADR-0064 semantic layer).

**Path:** `query_metric` → `result.value`

**Features:**
- Parses string numbers (`"123.45"` → `123.45`)
- Returns `null` for missing/invalid data

**Example:**
```typescript
const value = extractQueryValue(events);
// Returns: 9876543.21 or null
```

#### 2. `extractBrandNames`

```typescript
function extractBrandNames(events: SseEvent[]): string[]
```

Extracts brand names from `aggregate_objects` tool result.

**Path:** `aggregate_objects` → `groups[].key.brand`

**Features:**
- **Last-wins behavior**: Uses the LAST `aggregate_objects` result (Agent refines query over multiple calls)
- Filters out `'其他'` (Other) brand
- Deduplicates preserving order
- Trims whitespace

**Example:**
```typescript
const brands = extractBrandNames(events);
// Returns: ['小米', '美的', '九阳'] or []
```

#### 3. `extractModelNames`

```typescript
function extractModelNames(events: SseEvent[]): string[]
```

Extracts model names from `aggregate_objects` tool result.

**Path:** `aggregate_objects` → `groups[].key.model`

**Features:**
- **Last-wins behavior** (same reasoning as brands)
- Deduplicates preserving order
- Trims whitespace

**Example:**
```typescript
const models = extractModelNames(events);
// Returns: ['MI-RCA-5L', 'MD-X500', 'JY-F40FZ'] or []
```

#### 4. `extractChartSchema`

```typescript
interface ChartSchema {
  type: string;
  datasets: Array<{ label: string; data: number[] }>;
  labels: string[];
}

function extractChartSchema(events: SseEvent[]): ChartSchema | null
```

Extracts chart configuration from `render_chart` tool result.

**Path:** `render_chart` → `{ type, data: { datasets, labels } }`

**Features:**
- Validates structure (filters invalid datasets)
- Normalizes nested data structure
- Type-safe number/string filtering

**Example:**
```typescript
const chart = extractChartSchema(events);
if (chart) {
  expect(chart.type).toBe('bar');
  expect(chart.labels).toEqual(['2023-01', '2023-02', '2023-03']);
}
```

#### 5. `extractTextContent`

```typescript
function extractTextContent(events: SseEvent[]): string
```

Extracts prose response from Agent.

**Path:** First `text` event → `content`

**Example:**
```typescript
const text = extractTextContent(events);
expect(text).toContain('电饭煲市场规模');
```

## Design Principles

### 1. Graceful Degradation

All extractors return `null` or empty arrays for missing/malformed data — **never throw**.

```typescript
extractQueryValue([]) === null           // ✅ not throw
extractBrandNames([]) === []             // ✅ not throw
extractChartSchema([{ invalid: true }]) // ✅ null, not throw
```

### 2. Type Safety

Generic `extractToolResult<T>` provides flexible typed extraction:

```typescript
const metricResult = extractToolResult<{ result: { value: number } }>(events, 'query_metric');
const aggResult = extractToolResult<{ groups: Array<{...}> }>(events, 'aggregate_objects');
```

### 3. Last-Wins Behavior

Brand/model extractors use the LAST matching result because the Agent typically refines queries:

```typescript
// Query 1: All brands → ['小米', '美的', '九阳', '其他']
// Query 2: Top 3 only → ['小米', '美的', '九阳']  ← This is returned
```

This matches `delivery-report/scenario-judges.ts` patterns (lines 70-82, 107-119).

### 4. Defensive Filtering

- Brand extractor: filters `'其他'` (Other)
- Chart extractor: validates dataset structure
- All extractors: trim whitespace, deduplicate

## Testing

### Unit Tests (Jest)

**File:** `sse-extractors.unit.spec.ts`

**Coverage:**
- ✅ Generic extraction with different data types
- ✅ Specific extractors (query, brands, models, chart, text)
- ✅ Graceful null handling
- ✅ Last-wins behavior for multi-result queries
- ✅ Edge cases (malformed data, missing fields, invalid structure)

**Run:** (Currently requires placement in `src/` for Jest to find)
```bash
# Move to src for Jest
npm test -- sse-extractors
```

### Verification Script (Node.js)

**File:** `verify-sse-extractors.js`

**Tests:** 8 core scenarios with mock SSE events

**Run:**
```bash
node test/ontology-harness/verify-sse-extractors.js
```

**Result:**
```
📊 Results: 8 passed, 0 failed
```

## Integration with Ontology Ground Truth

These extractors are designed for Phase 2.1 delivery report scenarios:

```typescript
import { extractQueryValue, extractBrandNames } from './sse-extractors';
import { OntologyGroundTruth } from './ontology-ground-truth';

// Example: Verify Agent query result against ground truth
async function verifyMarketValue(events: SseEvent[], gt: OntologyGroundTruth) {
  const agentValue = extractQueryValue(events);
  const truthValue = await gt.marketMetricValue({
    tenantId: '...',
    filters: { category: '电饭煲', month: '2024-01', metric: '零售额' }
  });
  
  expect(agentValue).toBeCloseTo(truthValue, 2);
}

// Example: Verify brand ranking
async function verifyBrandRanking(events: SseEvent[], gt: OntologyGroundTruth) {
  const agentBrands = extractBrandNames(events).slice(0, 5);
  const truthBrands = await gt.brandShareTopN({
    tenantId: '...',
    category: '电饭煲',
    period: '2024Q1',
    limit: 5,
    withValues: false
  });
  
  expect(agentBrands).toEqual(truthBrands);
}
```

## Related Files

- **`delivery-report/scenario-judges.ts`** — Original pattern source (extractQueryValue lines 7-65, extractBrandNames lines 67-103)
- **`test-helpers.ts`** — SSE event type definitions and `postSse` helper
- **`ontology-ground-truth.ts`** — Ground truth SQL oracle (uses these extractors)
- **`verdict-helpers.ts`** — Verdict functions (compareNumeric, compareRanking)

## Implementation Notes

### SSE Event Structure

```typescript
interface SseEvent {
  type: string;        // 'tool_call' | 'tool_result' | 'text'
  name?: string;       // Tool name (e.g., 'query_metric')
  id?: string;         // Call ID for matching call/result pairs
  data?: unknown;      // Tool result payload (already parsed JSON)
  content?: string;    // Text response content
  [key: string]: unknown;
}
```

### Tool Result Paths

| Tool | Result Path | Example |
|------|-------------|---------|
| `query_metric` | `data.result.value` | `{ result: { value: 9876543.21 } }` |
| `aggregate_objects` | `data.groups[].key.brand` | `{ groups: [{ key: { brand: '小米' }, metrics: {...} }] }` |
| `aggregate_objects` | `data.groups[].key.model` | `{ groups: [{ key: { model: 'MI-5L' }, metrics: {...} }] }` |
| `render_chart` | `data.type`, `data.data.{datasets,labels}` | `{ type: 'bar', data: { datasets: [...], labels: [...] } }` |

### Why Last-Wins for Brands/Models

The Agent often refines its query across multiple tool calls:

1. **Broad query**: "Show me all brands" → 20 brands including '其他'
2. **Refined query**: "Top 5 brands only" → 5 brands, no '其他'

The LAST result is the most refined and relevant to the user's question, so extractors prefer it over earlier results.

This matches the empirical pattern in `delivery-report/scenario-judges.ts`:

```typescript
// Lines 70-82: "Uses the LAST (most refined) query_objects result with brand data"
for (const ev of queryResults) {
  // ... extract brands ...
  if (brands.length > 0) queryBrands = brands; // ← keep overwriting, last wins
}
```

## Future Extensions

Potential additional extractors for Phase 2.2+:

- `extractTimeSeries`: Extract time-ordered data points for trend analysis
- `extractAggregateGroups`: Generic group-by extraction with multiple dimensions
- `extractCoverage`: Extract data completeness metadata
- `extractToolCallSequence`: Reconstruct Agent's query refinement path for behavior analysis

## Verification

✅ **All 8 manual verification tests pass**
✅ **Patterns match `delivery-report/scenario-judges.ts`**
✅ **Type-safe with TypeScript generics**
✅ **Graceful error handling (no throws)**
✅ **Ready for integration with Ontology Ground Truth harness**
