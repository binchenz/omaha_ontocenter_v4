import { BadRequestException } from '@nestjs/common';
import { compile, parse, emit, emitScope, type ObjectInstanceScope, type Predicate, type OntologyView } from '@omaha/dsl';
import type { QueryFilter, FilterOperator } from '@omaha/shared-types';

const FILTER_TO_SQL: Record<FilterOperator, string> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  contains: 'LIKE',
  in: 'IN',
};

export interface ScopedWhereOptions {
  /** Materialized-view path: tenant/objectType filter is baked into the view,
   *  so the scope WHERE degrades to `1=1`. Mutually exclusive with keepFrom. */
  useView?: boolean;
  /** Keep the full `FROM object_instances WHERE …` prefix instead of stripping
   *  it to a bare WHERE fragment. Used by include fetches that build their own
   *  SELECT around the scope. */
  keepFrom?: boolean;
}

/**
 * The single builder that assembles a scoped WHERE: it owns the
 * `FROM object_instances WHERE …` seam (ADR-0007's emitScope), user filters
 * (incl. derived properties), permission Predicates, and — critically — the
 * `$N` parameter offset bookkeeping that every fragment source depends on.
 *
 * Holds a mutable params array; instantiate one per query. The three query
 * paths (plan / planAggregate / fetchIncludes) differ only in which add-methods
 * they call, not in how scoping or param numbering works.
 */
export class ScopedWhere {
  private readonly pieces: string[] = [];
  readonly params: unknown[] = [];
  private readonly auditPredicates: string[] = [];
  private readonly keepFrom: boolean;

  constructor(scope: ObjectInstanceScope, opts: ScopedWhereOptions = {}) {
    this.keepFrom = opts.keepFrom ?? false;
    if (opts.useView) {
      // View already encodes tenant/objectType — no scope params to seed.
      this.pieces.push('1=1');
      return;
    }
    const scopeFragment = emitScope(scope);
    this.params.push(...scopeFragment.params);
    if (this.keepFrom) {
      this.pieces.push(scopeFragment.sql);
    } else {
      this.pieces.push(scopeFragment.sql.replace(/^FROM object_instances WHERE /, ''));
    }
  }

  /** Full-text search over the denormalized search_text column. */
  search(term?: string): this {
    if (term) {
      this.pieces.push(`search_text ILIKE $${this.params.push('%' + term + '%')}`);
    }
    return this;
  }

  /** Append user filters; each compiles to one WHERE conjunct. */
  filters(fs: QueryFilter[] | undefined, view: OntologyView | null, objectType: string): this {
    for (const f of fs ?? []) {
      this.pieces.push(this.compileFilter(f, view, objectType));
    }
    return this;
  }

  /** Append permission Predicates and accumulate the audit string. */
  predicates(ps: Predicate[] | undefined): this {
    for (const predicate of ps ?? []) {
      this.pieces.push(this.mergeFragment(emit(predicate)));
      this.auditPredicates.push(JSON.stringify({ ast: predicate.ast, params: predicate.params }));
    }
    return this;
  }

  /**
   * Append a hand-written conjunct whose `?` placeholders are renumbered to the
   * current offset. For include fetches that bolt a foreign-key filter onto the
   * scope; keeps that SQL inside the one param-offset authority.
   */
  raw(sql: string, ...values: unknown[]): this {
    let i = 0;
    const renumbered = sql.replace(/\?/g, () => `$${this.params.length + (++i)}`);
    this.params.push(...values);
    this.pieces.push(renumbered);
    return this;
  }

  build(): { where: string; fromWhere: string; params: unknown[]; effectivePermissionFilter: string | null } {
    const joined = this.pieces.join(' AND ');
    return {
      where: joined,
      fromWhere: this.keepFrom ? joined : `FROM object_instances WHERE ${joined}`,
      params: this.params,
      effectivePermissionFilter: this.auditPredicates.length ? this.auditPredicates.join(' AND ') : null,
    };
  }

  private compileFilter(f: QueryFilter, view: OntologyView | null, objectTypeName: string): string {
    if (f.derivedProperty) {
      if (!view) throw new BadRequestException(`Unknown derived property: ${f.derivedProperty}`);
      const def = view.derivedProperties.get(f.derivedProperty);
      if (!def) throw new BadRequestException(`Unknown derived property: ${f.derivedProperty}`);
      const fragment = compile(parse(def.expression), {
        numericFields: view.numericFields,
        booleanFields: view.booleanFields,
        stringFields: view.stringFields,
        relations: view.relations,
        params: f.params ?? {},
      });
      // mergeFragment mutates params — call once, reuse for both lhs roles.
      const remapped = `(${this.mergeFragment(fragment)})`;
      return this.applyOperator(remapped, f, remapped);
    }

    if (!f.field) {
      throw new BadRequestException('Filter must have either field or derivedProperty');
    }

    if (view && (view.filterableFields.size > 0 || view.visibilityRestricted) && !view.filterableFields.has(f.field)) {
      throw new BadRequestException({
        code: 'PROPERTY_NOT_FILTERABLE',
        property: f.field,
        objectType: objectTypeName,
        hint: `Ask the admin to flag '${f.field}' as filterable on '${objectTypeName}'.`,
      });
    }

    const lhs = view?.numericFields.has(f.field)
      ? `(properties->>'${f.field}')::numeric`
      : `properties->>'${f.field}'`;
    // null checks must read raw jsonb text, not the ::numeric cast.
    return this.applyOperator(lhs, f, `properties->>'${f.field}'`);
  }

  /**
   * The shared operator tail for both plain fields and derived properties:
   * eq/neq-against-null → IS [NOT] NULL (bug #34), contains → escaped ILIKE
   * (bug #35), everything else → `<lhs> <op> $N`.
   */
  private applyOperator(lhs: string, f: QueryFilter, nullCheckLhs: string): string {
    if (f.value === null && (f.operator === 'eq' || f.operator === 'neq')) {
      return `${nullCheckLhs} IS ${f.operator === 'eq' ? '' : 'NOT '}NULL`;
    }
    if (f.operator === 'contains') {
      const escaped = String(f.value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      this.params.push(`%${escaped}%`);
      return `${nullCheckLhs} ILIKE $${this.params.length}`;
    }
    const opSql = FILTER_TO_SQL[f.operator];
    this.params.push(f.value);
    return `${lhs} ${opSql} $${this.params.length}`;
  }

  /** Renumber a context-free `$1`-based fragment to the current offset. */
  private mergeFragment(fragment: { sql: string; params: unknown[] }): string {
    const offset = this.params.length;
    const remapped = fragment.sql.replace(/\$(\d+)/g, (_m, idx) => `$${Number(idx) + offset}`);
    this.params.push(...fragment.params);
    return remapped;
  }
}
