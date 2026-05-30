import { Injectable, Logger } from '@nestjs/common';
import { CoreSdkService, OntologySchema } from '../sdk/core-sdk.service';

/**
 * Back-translates a query/aggregate tool call into a one-line Chinese summary
 * of what the plan computed, using ontology labels. Surfaced inline beneath the
 * assistant's answer so the user can sanity-check a derived number at decision
 * time rather than trusting a black box (ADR-0029).
 *
 * Defensive by construction: never throws. Malformed args yield a best-effort
 * partial summary; a non-data tool yields null.
 */
@Injectable()
export class PlanSummarizer {
  private readonly logger = new Logger(PlanSummarizer.name);

  constructor(private readonly sdk: CoreSdkService) {}

  async summarize(
    tenantId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string | null> {
    if (toolName !== 'query_objects' && toolName !== 'aggregate_objects') return null;
    try {
      const schema = await this.sdk.getSchema(tenantId);
      return toolName === 'aggregate_objects'
        ? this.summarizeAggregate(schema, args)
        : this.summarizeQuery(schema, args);
    } catch (err: any) {
      this.logger.warn(`planSummary failed for ${toolName}: ${err?.message ?? err}`);
      return null;
    }
  }

  // --- label resolution ---

  private typeLabel(schema: OntologySchema, name: unknown): string {
    const t = schema.types.find((x) => x.name === name);
    return t?.label || String(name ?? '');
  }

  /** Field label on a given object type; falls back to the raw field name. */
  private fieldLabel(schema: OntologySchema, typeName: string, field: string): string {
    const t = schema.types.find((x) => x.name === typeName);
    const p = t?.properties.find((x) => x.name === field);
    return p?.label || field;
  }

  private fieldUnit(schema: OntologySchema, typeName: string, field: string): string {
    const t = schema.types.find((x) => x.name === typeName);
    return t?.properties.find((x) => x.name === field)?.unit ?? '';
  }

  /**
   * Resolve a groupBy key to a label. A plain field is labelled on the base
   * type; a cross-rel dot-path "relName.field" resolves relName to the related
   * type (the side that is not the base) and labels the field there.
   */
  private groupKeyLabel(schema: OntologySchema, baseType: string, key: string): string {
    if (!key.includes('.')) return this.fieldLabel(schema, baseType, key);
    const [relName, field] = key.split('.', 2);
    const rel = schema.relationships.find((r) => r.name === relName);
    const relatedType = rel
      ? rel.sourceType === baseType
        ? rel.targetType
        : rel.sourceType
      : baseType;
    const relTypeLabel = this.typeLabel(schema, relatedType);
    return `${relTypeLabel}的${this.fieldLabel(schema, relatedType, field)}`;
  }

  // --- vocabulary ---

  private static readonly OPERATORS: Record<string, string> = {
    eq: '等于', neq: '不等于', gt: '大于', gte: '大于等于',
    lt: '小于', lte: '小于等于', contains: '包含', in: '属于',
  };

  private static readonly METRICS: Record<string, string> = {
    count: '数量', countDistinct: '去重计数', sum: '求和',
    avg: '平均值', min: '最小值', max: '最大值',
  };

  private describeFilters(schema: OntologySchema, baseType: string, filters: unknown): string {
    if (!Array.isArray(filters) || filters.length === 0) return '';
    const parts = filters
      .filter((f: any) => f && typeof f.field === 'string')
      .map((f: any) => {
        const label = this.fieldLabel(schema, baseType, f.field);
        const op = PlanSummarizer.OPERATORS[f.operator] ?? f.operator ?? '';
        const val = f.value === undefined ? '' : ` ${String(f.value)}`;
        return `${label} ${op}${val}`.trim();
      });
    return parts.length ? `筛选 ${parts.join('、')}` : '';
  }

  private describeMetrics(schema: OntologySchema, baseType: string, metrics: unknown): string {
    if (!Array.isArray(metrics) || metrics.length === 0) return '';
    const parts = metrics
      .filter((m: any) => m && typeof m.kind === 'string')
      .map((m: any) => {
        const kind = PlanSummarizer.METRICS[m.kind] ?? m.kind;
        if (m.kind === 'count') return kind; // count takes no field
        if (!m.field) return kind;
        const unit = this.fieldUnit(schema, baseType, m.field);
        return `${this.fieldLabel(schema, baseType, m.field)}的${kind}${unit ? `（${unit}）` : ''}`;
      });
    return parts.join('、');
  }

  // --- per-tool summaries ---

  private summarizeQuery(schema: OntologySchema, args: Record<string, unknown>): string {
    const base = String(args.objectType ?? '');
    const segs = [`查询了「${this.typeLabel(schema, base)}」`];
    const filters = this.describeFilters(schema, base, args.filters);
    if (filters) segs.push(filters);
    const sort = args.sort as { field?: string; direction?: string } | undefined;
    if (sort?.field) {
      const dir = sort.direction === 'desc' ? '降序' : '升序';
      segs.push(`按 ${this.fieldLabel(schema, base, sort.field)} ${dir}`);
    }
    return segs.join('，');
  }

  private summarizeAggregate(schema: OntologySchema, args: Record<string, unknown>): string {
    const base = String(args.objectType ?? '');
    const segs = [`查询了「${this.typeLabel(schema, base)}」`];
    const filters = this.describeFilters(schema, base, args.filters);
    if (filters) segs.push(filters);
    const groupBy = Array.isArray(args.groupBy) ? (args.groupBy as unknown[]).map(String) : [];
    if (groupBy.length > 0) {
      segs.push(`按 ${groupBy.map((g) => this.groupKeyLabel(schema, base, g)).join('、')} 分组`);
    }
    const metrics = this.describeMetrics(schema, base, args.metrics);
    if (metrics) segs.push(`统计 ${metrics}`);
    return segs.join('，');
  }
}

