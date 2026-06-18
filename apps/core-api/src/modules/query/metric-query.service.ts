import { Injectable, BadRequestException } from '@nestjs/common';
import type { CurrentUser as CurrentUserType } from '@omaha/shared-types';
import { QueryService, type AggregationResponse } from './query.service';
import { resolveMetric, bind, type MetricSelection } from './metric-resolver';
import { AVC_METRIC_CATALOGUE, type MetricDef } from './metric-catalogue';

export interface MetricQueryResult {
  /** The resolved canonical metric name. */
  metric: string;
  /** The token that matched (canonical name or a synonym). */
  matchedOn: string;
  /** The source star the metric resolved to. */
  star: string;
  /** The aggregate response — its groups carry the slice-① MeasureCell envelope. */
  result: AggregationResponse;
}

/**
 * MetricQueryService (ADR-0064 §4) — the deterministic resolve→bind→execute path
 * behind the `query_metric` tool. A thin deep module: it owns the "select a metric"
 * contract end-to-end (name/synonym → catalogue entry → AggregateObjectsRequest →
 * QueryService.aggregateObjects), so the answer rides the slice-① envelope with the
 * correct caliber. It adds NO new query engine — it sits above the ADR-0017 primitive.
 */
@Injectable()
export class MetricQueryService {
  constructor(private readonly queryService: QueryService) {}

  /** Resolve a metric name/synonym to its catalogue entry, or throw a structured error. */
  resolve(metric: string): { entry: MetricDef; matchedOn: string } {
    const resolved = resolveMetric(metric, AVC_METRIC_CATALOGUE);
    if (!resolved) {
      throw new BadRequestException({
        error: {
          code: 'METRIC_NOT_IN_CATALOGUE',
          message: `'${metric}' 不在指标目录中。`,
          field: 'metric',
          available: AVC_METRIC_CATALOGUE.map((m) => m.name),
          hint: `可选指标：${AVC_METRIC_CATALOGUE.map((m) => m.name).join('、')}。若确需目录外的查询，改用 aggregate_objects 自由组合。`,
        },
      });
    }
    return resolved;
  }

  /**
   * Run a catalogue metric end-to-end. The returned aggregate groups already carry
   * the MeasureCell envelope (slice ①) with the metric's unit/additivity/universe.
   */
  async query(user: CurrentUserType, selection: MetricSelection): Promise<MetricQueryResult> {
    const { entry, matchedOn } = this.resolve(selection.metric);
    const request = bind(entry, selection);
    const result = await this.queryService.aggregateObjects(user, request);
    return { metric: entry.name, matchedOn, star: entry.star, result };
  }
}
