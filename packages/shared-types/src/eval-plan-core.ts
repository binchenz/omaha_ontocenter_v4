/**
 * The semantic core of a query/aggregate plan — the fields that decide whether the
 * Agent understood the *question*, stripped of execution details (limit, default
 * orderBy, select column order, page size) that vary run-to-run without changing
 * meaning (ADR-0033). This is the contract between Evals capture and scoring.
 */
export interface PlanSemanticCore {
  tool: 'query_objects' | 'aggregate_objects' | 'unknown';
  objectType: string;
  /** Aggregation metrics as `kind:field` (field omitted for count). Order-independent. */
  metrics: string[];
  /** Filtered fields paired with a normalized operator DIRECTION (see normalizeOperator). */
  filters: string[];
  /** groupBy keys, including cross-relationship dot-paths ("relName.field"). Order-independent. */
  groupBy: string[];
  /** Sort field with direction, when the sort is semantically meaningful (query_objects). */
  sort: string | null;
}

export interface PlanComparison {
  match: boolean;
  /** Human-readable reasons for each mismatch (empty when match). */
  diffs: string[];
}

/**
 * The tools whose calls carry a queryable plan worth capturing/scoring for Evals.
 * Single source of truth for "is this tool call a data query?" — `extractPlanCore`
 * and the Evals capture path both derive from this rather than re-listing the names.
 */
export const DATA_QUERY_TOOLS = ['query_objects', 'aggregate_objects'] as const;

export type DataQueryTool = (typeof DATA_QUERY_TOOLS)[number];

export function isDataQueryTool(toolName: string): toolName is DataQueryTool {
  return (DATA_QUERY_TOOLS as readonly string[]).includes(toolName);
}

/**
 * Collapse a filter operator to its semantic DIRECTION. This is the concrete encoding
 * of the ADR-0029 gt/gte lesson: "超过 5"(gt) and "至少 5"(gte) differ only in boundary
 * inclusion — a prompt-convention detail, not a comprehension error — so they collapse
 * to the same `>` bucket. But gt vs lt ("over" vs "under") IS a real difference and is
 * preserved. eq/neq/contains/in keep their identity.
 */
export function normalizeOperator(op: unknown): string {
  switch (op) {
    case 'gt':
    case 'gte':
      return '>';
    case 'lt':
    case 'lte':
      return '<';
    case 'eq':
      return '=';
    case 'neq':
      return '!=';
    case 'contains':
      return 'contains';
    case 'in':
      return 'in';
    default:
      return String(op ?? '');
  }
}

/**
 * Extract the semantic core from a tool call's args (the LLM-produced plan). Pure;
 * tolerant of malformed args. The filter VALUE is deliberately excluded — only the
 * field and operator-direction are semantic; values are where boundary noise lives.
 */
export function extractPlanCore(toolName: string, args: Record<string, unknown>): PlanSemanticCore {
  const tool: PlanSemanticCore['tool'] = isDataQueryTool(toolName) ? toolName : 'unknown';

  const objectType = typeof args.objectType === 'string' ? args.objectType : '';

  const metrics = arr(args.metrics)
    .map((m) => (isRec(m) ? m : {}))
    .filter((m) => typeof m.kind === 'string')
    .map((m) => (m.kind === 'count' ? 'count' : `${m.kind}:${m.field ?? ''}`))
    .sort();

  const filters = arr(args.filters)
    .map((f) => (isRec(f) ? f : {}))
    .filter((f) => typeof f.field === 'string')
    .map((f) => `${f.field}:${normalizeOperator(f.operator)}`)
    .sort();

  const groupBy = arr(args.groupBy).map((g) => String(g)).sort();

  let sort: string | null = null;
  const s = args.sort;
  if (isRec(s) && typeof s.field === 'string') {
    sort = `${s.field}:${s.direction === 'desc' ? 'desc' : 'asc'}`;
  }

  return { tool, objectType, metrics, filters, groupBy, sort };
}

/**
 * Compare a candidate plan core against an expected baseline. Structural equality on
 * the semantic-core fields; returns the specific differences for display. A sort that
 * is absent in BOTH is a match; a sort difference is reported but does NOT by itself
 * fail the comparison for an aggregate plan (orderBy is an execution detail there) —
 * only for query_objects, where "按时长降序" is the answer's substance.
 */
export function comparePlanCore(expected: PlanSemanticCore, actual: PlanSemanticCore): PlanComparison {
  const diffs: string[] = [];

  if (expected.objectType !== actual.objectType) {
    diffs.push(`对象类型：期望 ${expected.objectType || '(空)'}，实际 ${actual.objectType || '(空)'}`);
  }
  diffSet('指标', expected.metrics, actual.metrics, diffs);
  diffSet('过滤字段', expected.filters, actual.filters, diffs);
  diffSet('分组', expected.groupBy, actual.groupBy, diffs);

  // Sort is semantic only for plain queries; for aggregates it's an execution detail.
  const sortIsSemantic = expected.tool === 'query_objects' || actual.tool === 'query_objects';
  if (sortIsSemantic && (expected.sort ?? null) !== (actual.sort ?? null)) {
    diffs.push(`排序：期望 ${expected.sort ?? '(无)'}，实际 ${actual.sort ?? '(无)'}`);
  }

  return { match: diffs.length === 0, diffs };
}

function diffSet(label: string, expected: string[], actual: string[], diffs: string[]): void {
  const e = [...expected].sort();
  const a = [...actual].sort();
  if (e.length !== a.length || e.some((v, i) => v !== a[i])) {
    diffs.push(`${label}：期望 [${e.join(', ')}]，实际 [${a.join(', ')}]`);
  }
}

/** Convenience: extract both plans and compare in one call. */
export function scorePlan(
  expected: { tool: string; args: Record<string, unknown> },
  actual: { tool: string; args: Record<string, unknown> },
): PlanComparison {
  return comparePlanCore(extractPlanCore(expected.tool, expected.args), extractPlanCore(actual.tool, actual.args));
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
