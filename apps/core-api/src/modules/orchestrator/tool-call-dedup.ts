/**
 * #194 convergence guardrail — per-turn tool-call deduplication.
 *
 * Open-ended strategic questions make the Agent re-issue the same query many times (the eval
 * caught S6 firing ~40 calls, ~20 of them re-fetching data it already had, then timing out).
 * This deep module collapses equivalent calls within one turn: the first call executes and its
 * result is cached; an equivalent later call returns the cached result without touching the DB.
 *
 * Equivalence is by tool name + the semantic query shape (objectType, filters, groupBy, metrics,
 * sort, include). Pagination fields (page/pageSize/pageToken/maxGroups) are deliberately excluded
 * so re-fetching an earlier page counts as a repeat. The cache lives for one `run()` turn only.
 */
export class ToolCallDedup {
  private readonly cache = new Map<string, unknown>();

  /** Stable equivalence key: tool name + canonicalized semantic args (order-independent). */
  static key(name: string, args: Record<string, unknown>): string {
    const canonical = {
      objectType: args.objectType ?? null,
      filters: stableStringify(args.filters),
      groupBy: stableStringify(args.groupBy),
      metrics: stableStringify(args.metrics),
      sort: stableStringify(args.sort),
      orderBy: stableStringify(args.orderBy),
      include: stableStringify(args.include),
      search: args.search ?? null,
    };
    // Tools with no recognized query shape (all canonical fields empty/absent) fall back to the
    // full args so unrelated calls never collide. Canonical values are strings; absent fields
    // stringify to the literal 'null', so an empty shape is one of these three sentinels.
    const isEmpty = (v: unknown): boolean => v === null || v === 'null' || v === '[]' || v === '{}';
    const recognized = Object.values(canonical).some((v) => !isEmpty(v));
    return recognized ? `${name}:${stableStringify(canonical)}` : `${name}:${stableStringify(args)}`;
  }

  /** Returns the cached result for an equivalent prior call this turn, or undefined. */
  get(name: string, args: Record<string, unknown>): { hit: boolean; value: unknown } {
    const k = ToolCallDedup.key(name, args);
    return this.cache.has(k) ? { hit: true, value: this.cache.get(k) } : { hit: false, value: undefined };
  }

  /** Record a freshly-executed call's result so an equivalent later call can reuse it. */
  set(name: string, args: Record<string, unknown>, value: unknown): void {
    this.cache.set(ToolCallDedup.key(name, args), value);
  }
}

/** Deterministic JSON: object keys sorted recursively so {a,b} and {b,a} stringify identically. */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((acc, k) => {
        acc[k] = sortKeys((value as Record<string, unknown>)[k]);
        return acc;
      }, {} as Record<string, unknown>);
  }
  return value;
}
