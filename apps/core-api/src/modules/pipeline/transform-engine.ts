import { DuckDBInstance } from '@duckdb/node-api';

export type Row = Record<string, unknown>;

/** One named input relation handed to the engine. v1 (ADR-0060 #1) uses a single input. */
export interface TransformInput {
  name: string;
  rows: Row[];
}

/** A declarative, enum-constrained transform step (ADR-0053). `config` shape varies by `type`. */
export interface StepConfig {
  order: number;
  type: string;
  config: Record<string, unknown>;
}

/**
 * Carries the failing step order + the row index within that step's input so a PipelineRun can
 * explain exactly where execution broke (ADR-0060 acceptance: structured step errors survive the
 * engine swap). rowIndex is -1 for whole-step failures with no single offending row.
 */
export class TransformStepError extends Error {
  constructor(
    public readonly stepOrder: number,
    public readonly rowIndex: number,
    message: string,
  ) {
    super(message);
    this.name = 'TransformStepError';
  }
}

/**
 * Deep module (ADR-0060 #1): the Pipeline transform executor. Its only contract is
 * `run(inputs, steps) → rows`; internally it compiles each declarative step to DuckDB SQL and
 * executes in a private in-process DuckDB database. No Prisma / pg-boss / orchestrator coupling —
 * callers resolve any external config (e.g. version-pinned TransformConfig, ADR-0054) and inline
 * the result into the step's config before calling run().
 *
 * Replaces the former in-memory `Row[]` executor; the 100k-row in-memory ceiling is gone — DuckDB's
 * columnar engine handles the real volume, and over-limit inputs fail loudly rather than OOM.
 */
export class TransformEngine {
  async run(inputs: TransformInput[], steps: StepConfig[]): Promise<Row[]> {
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    try {
      // Materialize every named input as `in_<i>` so a multi-input `join` step can reference either
      // by name. Each table is a dense, 0-based, order-preserving relation `(ri, data JSON)`. The
      // loads are independent, so a multi-input join doesn't serialize one input's parse behind another.
      const inputTables = new Map<string, string>();
      await Promise.all(
        inputs.map((input, i) => {
          inputTables.set(input.name, `in_${i}`);
          return this.materialize(conn, `in_${i}`, input.rows);
        }),
      );
      // The single-input pipeline (filter/rename/compute/…) flows from the first input forward.
      let current = inputTables.get(inputs[0].name)!;
      const ordered = [...steps].sort((a, b) => a.order - b.order);
      for (let i = 0; i < ordered.length; i++) {
        const next = `step${i + 1}`;
        await this.compileStep(conn, ordered[i], current, next, inputTables);
        current = next;
      }
      return await this.readBack(conn, current);
    } finally {
      conn.closeSync();
      instance.closeSync();
    }
  }

  /** Load Row[] into a table preserving input order as a dense 0-based `ri`. */
  private async materialize(conn: any, table: string, rows: Row[]): Promise<void> {
    await conn.run(
      `CREATE TABLE ${table} AS
       SELECT CAST(row_number() OVER () - 1 AS BIGINT) AS ri, j AS data
       FROM (SELECT unnest(from_json($1::JSON, '["JSON"]')) AS j)`,
      [JSON.stringify(rows)],
    );
  }

  /** Read the final relation back as Row[] in `ri` order. */
  private async readBack(conn: any, table: string): Promise<Row[]> {
    const reader = await conn.run(`SELECT CAST(data AS VARCHAR) AS data_str FROM ${table} ORDER BY ri`);
    const out = await reader.getRowObjects();
    return out.map((o: { data_str: string }) => JSON.parse(o.data_str) as Row);
  }

  private async compileStep(conn: any, step: StepConfig, current: string, next: string, inputTables: Map<string, string>): Promise<void> {
    switch (step.type) {
      case 'join':
        return this.compileJoin(conn, step, next, inputTables);
      case 'filter':
        return this.compileFilter(conn, step, current, next);
      case 'rename':
        return this.compileRename(conn, step, current, next);
      case 'compute':
        return this.compileCompute(conn, step, current, next);
      case 'dedup':
        return this.compileDedup(conn, step, current, next);
      case 'aggregate':
        return this.compileAggregate(conn, step, current, next);
      case 'explode_json':
        return this.compileExplodeJson(conn, step, current, next);
      default:
        throw new TransformStepError(step.order, -1, `Unknown step type: ${step.type}`);
    }
  }

  /**
   * explode_json: shred a nested JSON field (device-log payloads, ADR-0060 #2).
   *  - array mode: one output row per array element, each merged onto the parent row with the
   *    exploded field removed. Element order within a parent is preserved.
   *  - object mode: spread the field's keys up to top level (1 row in → 1 row out), field removed.
   */
  private async compileExplodeJson(conn: any, step: StepConfig, current: string, next: string): Promise<void> {
    const field = step.config.field as string;
    const mode = (step.config.mode ?? 'array') as string;
    // Parent object with the exploded field stripped (rebuilt from the surviving keys).
    const parentWithoutField =
      `(SELECT json_group_object(k.key, json_extract(s.data, '$."' || k.key || '"'))
        FROM unnest(json_keys(s.data)) AS k(key) WHERE k.key != ${sqlString(field)})`;

    if (mode === 'object') {
      await conn.run(
        `CREATE TABLE ${next} AS
         SELECT CAST(row_number() OVER () - 1 AS BIGINT) AS ri,
                CAST(json_merge_patch(${parentWithoutField}, json_extract(s.data, ${pathLiteral(field)})) AS JSON) AS data
         FROM (SELECT ri, data FROM ${current} ORDER BY ri) s`,
      );
      return;
    }
    if (mode === 'array') {
      await conn.run(
        `CREATE TABLE ${next} AS
         SELECT CAST(row_number() OVER () - 1 AS BIGINT) AS ri, data
         FROM (
           SELECT json_merge_patch(${parentWithoutField}, elem) AS data
           FROM (
             SELECT ri, data,
                    unnest(CAST(json_extract(data, ${pathLiteral(field)}) AS JSON[])) AS elem
             FROM ${current}
           ) s ORDER BY ri
         )`,
      );
      return;
    }
    throw new TransformStepError(step.order, -1, `explode_json: unsupported mode "${mode}"`);
  }

  /**
   * join (ADR-0060 #4, fact × fact only): merge two named inputs on a declared key set into a wide
   * clean relation. Right columns are merged onto left (json_merge_patch); `left`/`right` reference
   * input names from run()'s inputs. Output order follows the left input's `ri`. Fact × dimension
   * deliberately does NOT come here — it stays a query-time Field Path (ADR-0044).
   */
  private async compileJoin(conn: any, step: StepConfig, next: string, inputTables: Map<string, string>): Promise<void> {
    const leftName = step.config.left as string;
    const rightName = step.config.right as string;
    const joinType = (step.config.type ?? 'inner') as string;
    const on = (step.config.on ?? []) as Array<{ leftField: string; rightField: string }>;
    const leftTable = inputTables.get(leftName);
    const rightTable = inputTables.get(rightName);
    if (!leftTable) throw new TransformStepError(step.order, -1, `join: unknown left input "${leftName}"`);
    if (!rightTable) throw new TransformStepError(step.order, -1, `join: unknown right input "${rightName}"`);
    if (on.length === 0) throw new TransformStepError(step.order, -1, 'join: at least one join key is required');

    const sqlJoin = joinType === 'left' ? 'LEFT JOIN' : joinType === 'inner' ? 'JOIN' : null;
    if (!sqlJoin) throw new TransformStepError(step.order, -1, `join: unsupported join type "${joinType}"`);

    const onClause = on
      .map((k) => `json_extract_string(l.data, ${pathLiteral(k.leftField)}) = json_extract_string(r.data, ${pathLiteral(k.rightField)})`)
      .join(' AND ');
    // LEFT JOIN may yield a NULL right row; COALESCE keeps the unmatched left row intact.
    await conn.run(
      `CREATE TABLE ${next} AS
       SELECT CAST(row_number() OVER () - 1 AS BIGINT) AS ri, data
       FROM (
         SELECT COALESCE(json_merge_patch(l.data, r.data), l.data) AS data
         FROM ${leftTable} l ${sqlJoin} ${rightTable} r ON ${onClause}
         ORDER BY l.ri
       )`,
    );
  }

  /**
   * aggregate: GROUP BY the declared keys and emit one row per group with the named metrics.
   * Output is ordered by the group keys for deterministic clean Datasets. Metric ops are
   * enum-constrained (sum/count/avg/min/max); numeric ops coerce the field via TRY_CAST DOUBLE.
   */
  private async compileAggregate(conn: any, step: StepConfig, current: string, next: string): Promise<void> {
    const groupBy = (step.config.groupBy ?? []) as string[];
    const metrics = (step.config.metrics ?? []) as Array<{ op: string; field?: string; as: string }>;
    if (groupBy.length === 0) throw new TransformStepError(step.order, -1, 'aggregate: at least one groupBy key is required');
    if (metrics.length === 0) throw new TransformStepError(step.order, -1, 'aggregate: at least one metric is required');

    // Group-key aliases (g0, g1, …) are referenced in SELECT, GROUP BY, ORDER BY and the output
    // object — compute them once so the four uses can't drift apart.
    const groupAliases = groupBy.map((_, i) => `g${i}`);
    const groupExprs = groupBy.map((k, i) => `json_extract_string(data, ${pathLiteral(k)}) AS ${groupAliases[i]}`);
    const objEntries = [
      ...groupBy.map((k, i) => `${sqlString(k)}, ${groupAliases[i]}`),
      ...metrics.map((m, i) => `${sqlString(m.as)}, m${i}`),
    ];
    const metricExprs = metrics.map((m, i) => `${aggExpr(m, step.order)} AS m${i}`);

    await conn.run(
      `CREATE TABLE ${next} AS
       SELECT CAST(row_number() OVER () - 1 AS BIGINT) AS ri,
              CAST(json_object(${objEntries.join(', ')}) AS JSON) AS data
       FROM (
         SELECT ${[...groupExprs, ...metricExprs].join(', ')}
         FROM ${current}
         GROUP BY ${groupAliases.join(', ')}
         ORDER BY ${groupAliases.join(', ')}
       )`,
    );
  }

  /**
   * dedup: collapse rows sharing the same value across `keys`, keeping the first occurrence
   * (input order). row_number() over the key partition ordered by `ri` picks the survivor, then
   * `ri` is re-densified to mirror array compaction.
   */
  private async compileDedup(conn: any, step: StepConfig, current: string, next: string): Promise<void> {
    const keys = (step.config.keys ?? []) as string[];
    if (keys.length === 0) {
      throw new TransformStepError(step.order, -1, 'dedup: at least one key is required');
    }
    const partition = keys.map((k) => `json_extract_string(data, ${pathLiteral(k)})`).join(', ');
    await conn.run(
      `CREATE TABLE ${next} AS
       SELECT CAST(row_number() OVER () - 1 AS BIGINT) AS ri, data
       FROM (
         SELECT data FROM (
           SELECT ri, data, row_number() OVER (PARTITION BY ${partition} ORDER BY ri) AS rn FROM ${current}
         ) WHERE rn = 1 ORDER BY ri
       )`,
    );
  }

  /**
   * compute: applies a predefined function (normalize_brand) writing `outputField`. The resolved
   * lookup tables (mappings/bands) arrive inline in step config — the engine never reaches out to
   * TransformConfigService; the worker resolves the version-pinned config (ADR-0054) first.
   */
  private async compileCompute(conn: any, step: StepConfig, current: string, next: string): Promise<void> {
    const fn = step.config.function as string;
    switch (fn) {
      case 'normalize_brand':
        return this.compileNormalizeBrand(conn, step, current, next);
      case 'price_band':
        return this.compilePriceBand(conn, step, current, next);
      case 'concat':
        return this.compileConcat(conn, step, current, next);
      default:
        throw new TransformStepError(step.order, -1, `Unknown compute function: ${fn}`);
    }
  }

  /**
   * concat (#177): rebuild a derived key into `outputField` by joining the named `fields` with
   * `separator`. The reason it exists: a star's externalId is baked from raw columns BEFORE the
   * pipeline runs (avc-stars.ts), so normalize_brand rewrites the `brand` property but leaves a
   * stale externalId — dirty variants (苏泊 vs 苏泊尔) then keep distinct keys and never merge.
   * Re-deriving externalId from the normalized fields makes variants collide on one key, which a
   * following `aggregate` step sums. A missing field contributes an empty segment (string concat).
   */
  private async compileConcat(conn: any, step: StepConfig, current: string, next: string): Promise<void> {
    const fields = (step.config.fields ?? []) as string[];
    const separator = (step.config.separator ?? '_') as string;
    const outputField = step.config.outputField as string;
    if (fields.length === 0) throw new TransformStepError(step.order, -1, 'concat: at least one field is required');
    // COALESCE each extracted segment to '' so a missing field yields an empty part (not NULL key).
    const parts = fields.map((f) => `COALESCE(json_extract_string(data, ${pathLiteral(f)}), '')`);
    const concatExpr = parts.join(` || ${sqlString(separator)} || `);
    await conn.run(
      `CREATE TABLE ${next} AS
       SELECT ri, CAST(json_merge_patch(data, json_object(${sqlString(outputField)}, ${concatExpr})) AS JSON) AS data
       FROM ${current} ORDER BY ri`,
    );
  }

  /**
   * price_band: bin a numeric field into a label. Bands are ordered; the first whose `max >= value`
   * wins (<= boundary), and a band without `max` is the open-ended top band. Mirrors the former
   * `bands.find(b => b.max === undefined || num <= b.max)`.
   */
  private async compilePriceBand(conn: any, step: StepConfig, current: string, next: string): Promise<void> {
    const inputField = step.config.inputField as string;
    const outputField = step.config.outputField as string;
    const bands = (step.config.bands ?? []) as Array<{ max?: number; label: string }>;
    const num = `TRY_CAST(json_extract(data, ${pathLiteral(inputField)}) AS DOUBLE)`;
    const whens = bands
      .map((b) => (b.max === undefined ? `ELSE ${sqlString(b.label)}` : `WHEN ${num} <= ${numLiteral(b.max)} THEN ${sqlString(b.label)}`))
      .join(' ');
    // A non-numeric value yields NULL band *even when an open-ended band exists* — the in-memory impl
    // threw on NaN before band lookup, so the ELSE must not swallow non-numerics.
    const bandExpr = `CASE WHEN ${num} IS NULL THEN NULL ${whens} END`;

    // A NULL band means either a non-numeric value (num IS NULL) or a value past every band with no
    // open-ended band. The former in-memory impl threw per row; we surface the first offending row.
    const probe = await conn.run(
      `SELECT ri, (${num} IS NULL) AS non_numeric, CAST(json_extract(data, ${pathLiteral(inputField)}) AS VARCHAR) AS raw
       FROM ${current} WHERE (${bandExpr}) IS NULL ORDER BY ri LIMIT 1`,
    );
    const bad = await probe.getRowObjects();
    if (bad.length > 0) {
      const { ri, non_numeric, raw } = bad[0] as { ri: bigint; non_numeric: boolean; raw: string };
      const rowIndex = Number(ri);
      throw non_numeric
        ? new TransformStepError(step.order, rowIndex, `price_band: non-numeric value in field "${inputField}": ${raw}`)
        : new TransformStepError(step.order, rowIndex, `price_band: value ${raw} fell outside all configured bands`);
    }

    await conn.run(
      `CREATE TABLE ${next} AS
       SELECT ri, CAST(json_merge_patch(data, json_object(${sqlString(outputField)}, ${bandExpr})) AS JSON) AS data
       FROM ${current} ORDER BY ri`,
    );
  }

  /** normalize_brand: map source value (optionally case-insensitively) → label; passthrough unknowns. */
  private async compileNormalizeBrand(conn: any, step: StepConfig, current: string, next: string): Promise<void> {
    const inputField = step.config.inputField as string;
    const outputField = step.config.outputField as string;
    const mappings = (step.config.mappings ?? {}) as Record<string, string>;
    const caseSensitive = step.config.caseSensitive === true;
    const src = `json_extract_string(data, ${pathLiteral(inputField)})`;
    const joinKey = caseSensitive ? src : `LOWER(${src})`;

    if (Object.keys(mappings).length === 0) {
      // No mappings: every value passes through unchanged into outputField.
      await conn.run(
        `CREATE TABLE ${next} AS
         SELECT ri, CAST(json_merge_patch(data, json_object(${sqlString(outputField)}, ${src})) AS JSON) AS data
         FROM ${current} ORDER BY ri`,
      );
      return;
    }
    const mapValues = Object.entries(mappings)
      .map(([f, t]) => `(${sqlString(caseSensitive ? f : f.toLowerCase())}, ${sqlString(t)})`)
      .join(', ');
    await conn.run(`CREATE OR REPLACE TEMP TABLE ${next}_bmap AS SELECT * FROM (VALUES ${mapValues}) AS v(f, t)`);
    await conn.run(
      `CREATE TABLE ${next} AS
       SELECT s.ri,
         CAST(json_merge_patch(s.data, json_object(${sqlString(outputField)}, COALESCE(m.t, ${src}))) AS JSON) AS data
       FROM ${current} s LEFT JOIN ${next}_bmap m ON ${joinKey} = m.f
       ORDER BY s.ri`,
    );
  }

  /**
   * rename: rebuild each object remapping declared keys, leaving the rest and all value
   * types/structure intact. json_group_object over the original key set preserves key order; an
   * empty mapping is a no-op. Mirrors the former `out[mappings[key] ?? key] = value` rebuild.
   */
  private async compileRename(conn: any, step: StepConfig, current: string, next: string): Promise<void> {
    const mappings = (step.config.mappings ?? {}) as Record<string, string>;
    const entries = Object.entries(mappings);
    if (entries.length === 0) {
      await conn.run(`CREATE TABLE ${next} AS SELECT ri, data FROM ${current}`);
      return;
    }
    const mapValues = entries.map(([f, t]) => `(${sqlString(f)}, ${sqlString(t)})`).join(', ');
    await conn.run(`CREATE OR REPLACE TEMP TABLE ${next}_map AS SELECT * FROM (VALUES ${mapValues}) AS v(f, t)`);
    await conn.run(
      `CREATE TABLE ${next} AS
       SELECT ri,
         CAST(json_group_object(COALESCE(m.t, k.key), json_extract(s.data, '$."' || k.key || '"')) AS JSON) AS data
       FROM ${current} s, unnest(json_keys(s.data)) AS k(key)
       LEFT JOIN ${next}_map m ON m.f = k.key
       GROUP BY ri ORDER BY ri`,
    );
  }

  /** filter: keep rows matching the predicate, re-densifying `ri` to mirror array compaction. */
  private async compileFilter(conn: any, step: StepConfig, current: string, next: string): Promise<void> {
    const field = step.config.field as string;
    const operator = step.config.operator as string;
    const value = step.config.value;
    const predicate = buildPredicate(field, operator, value, step.order);
    await conn.run(
      `CREATE TABLE ${next} AS
       SELECT CAST(row_number() OVER () - 1 AS BIGINT) AS ri, data
       FROM (SELECT data FROM ${current} WHERE ${predicate} ORDER BY ri)`,
    );
  }
}

/** `$.field` JSON path literal, single-quote-escaped for SQL. */
function pathLiteral(field: string): string {
  return sqlString(`$.${field}`);
}

/** SQL single-quoted string literal (doubles embedded quotes). */
function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Build a SQL boolean predicate output-equivalent to the former in-memory `matchesOperator`.
 * eq mirrors strict `===` by comparing canonical JSON encodings (so string "5" ≠ number 5).
 */
function buildPredicate(field: string, operator: string, value: unknown, stepOrder: number): string {
  const extracted = `json_extract(data, ${pathLiteral(field)})`;
  // Numeric comparisons coerce both sides to DOUBLE, mirroring the former JS `(x as number)` casts;
  // TRY_CAST yields NULL on non-numeric text so the predicate is simply false (no match, no throw).
  const num = `TRY_CAST(${extracted} AS DOUBLE)`;
  // String form for text ops: json_extract_string unwraps JSON strings (no surrounding quotes).
  const str = `json_extract_string(data, ${pathLiteral(field)})`;
  switch (operator) {
    case 'eq':
      // Strict equality: compare canonical JSON encodings so string "5" ≠ number 5 (=== semantics).
      return `CAST(${extracted} AS VARCHAR) = ${sqlString(JSON.stringify(value))}`;
    case 'gt':
      return `${num} > ${numLiteral(value)}`;
    case 'lt':
      return `${num} < ${numLiteral(value)}`;
    case 'gte':
      return `${num} >= ${numLiteral(value)}`;
    case 'lte':
      return `${num} <= ${numLiteral(value)}`;
    case 'contains':
      // String(left).includes(String(right))
      return `${str} LIKE ${sqlString(`%${likeEscape(String(value))}%`)} ESCAPE '\\'`;
    case 'in':
      // Array.isArray(right) && right.includes(left): false when value is not an array.
      if (!Array.isArray(value)) return 'FALSE';
      if (value.length === 0) return 'FALSE';
      return `CAST(${extracted} AS VARCHAR) IN (${value.map((v) => sqlString(JSON.stringify(v))).join(', ')})`;
    default:
      throw new TransformStepError(stepOrder, -1, `Unsupported operator: ${operator}`);
  }
}

/** SQL aggregate expression for one enum-constrained metric (sum/count/avg/min/max). */
function aggExpr(metric: { op: string; field?: string; as: string }, stepOrder: number): string {
  if (metric.op === 'count') return 'COUNT(*)';
  if (!metric.field) {
    throw new TransformStepError(stepOrder, -1, `aggregate: metric "${metric.as}" (${metric.op}) requires a field`);
  }
  const num = `TRY_CAST(json_extract(data, ${pathLiteral(metric.field)}) AS DOUBLE)`;
  switch (metric.op) {
    case 'sum':
      return `SUM(${num})`;
    case 'avg':
      return `AVG(${num})`;
    case 'min':
      return `MIN(${num})`;
    case 'max':
      return `MAX(${num})`;
    default:
      throw new TransformStepError(stepOrder, -1, `aggregate: unsupported metric op "${metric.op}"`);
  }
}

/** Numeric SQL literal; NaN/non-finite collapse to a literal that never matches. */
function numLiteral(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? String(n) : 'CAST(\'nan\' AS DOUBLE)';
}

/** Escape LIKE wildcards so `contains` is a literal substring match. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
