import { MarketMetricRow, BrandShareRow, ModelMetricRow } from './avc-template-extractor';

/**
 * AVC star registry (#175, ADR-0055) — the single source of truth for the three AVC star
 * objects as they converge into the generic Connector + Pipeline data plane.
 *
 * Each star binds together everything the cutover needs in ONE place so the connector
 * (raw-Dataset fan-out), the pipeline provisioner (per-star connector + pipeline + mapping),
 * and the SyncJob mapping all key off the same names — no drift between three files.
 *
 * PER-STAR CONNECTORS (ADR-0055 routing amendment, see avc-cutover-routing memory): each star
 * gets its OWN connector type so the reactive orchestrator resolves exactly one active pipeline
 * per connector. A shared connector would fan a market raw Dataset into the brand/model
 * pipelines too (whose compute steps reference fields the market rows lack).
 *
 * Raw rows are FLAT (`{ externalId, label, ...properties }`) because the SyncJobWorker reads
 * `externalId` off the row and maps properties via an identity `{ prop: col }` ObjectMapping.
 */

export type AvcStarRow = Record<string, unknown> & { externalId: string; label: string };

export interface AvcStarSpec {
  /** Output ObjectType name (also the star's logical id). */
  objectType: string;
  /** Pipeline name created for this star (stable so idempotency + cutover can find it). */
  pipelineName: string;
  /** Per-star connector type (unique so onRawDatasetReady resolves exactly one pipeline). */
  connectorType: string;
  /** Human label for the per-star connector. */
  connectorName: string;
  /** Raw Dataset name prefix; the connector appends category/period for lineage. */
  datasetPrefix: string;
}

export const MARKET_METRIC_TYPE = 'market_metric';
export const BRAND_SHARE_TYPE = 'brand_share';
export const MODEL_METRIC_TYPE = 'model_metric';

export const AVC_STARS: AvcStarSpec[] = [
  {
    objectType: MARKET_METRIC_TYPE,
    pipelineName: 'avc_market_metric',
    connectorType: 'avc_market_excel',
    connectorName: 'AVC 市场指标',
    datasetPrefix: 'avc_market',
  },
  {
    objectType: BRAND_SHARE_TYPE,
    pipelineName: 'avc_brand_share',
    connectorType: 'avc_brand_excel',
    connectorName: 'AVC 品牌份额',
    datasetPrefix: 'avc_brand',
  },
  {
    objectType: MODEL_METRIC_TYPE,
    pipelineName: 'avc_model_metric',
    connectorType: 'avc_model_excel',
    connectorName: 'AVC 机型指标',
    datasetPrefix: 'avc_model',
  },
];

/** Flatten a star instance ({externalId, label, properties}) into a raw Dataset row. */
const flatten = (inst: { externalId: string; label: string; properties: Record<string, unknown> }): AvcStarRow => ({
  externalId: inst.externalId,
  label: inst.label,
  ...inst.properties,
});

// ── Raw-row mappers (single source of truth per star type) ─────────────
// Mirror the externalId/property contract the legacy importStar path used, so the
// reactive chain lands identical object_instances (brand normalization aside).

export const toMarketMetricRawRow = (r: MarketMetricRow): AvcStarRow =>
  flatten({
    externalId: `${r.category}_${r.month}_${r.metric}`,
    label: `${r.category} ${r.month} ${r.metric}`,
    // `year` is derived from `month` at ingest (write-once, never recomputed at query time) so
    // `aggregate_objects` can `group by year` deterministically — the Agent must never hand-sum
    // months in a reply (ADR-0059). Keep year in lockstep with month; this is the only writer.
    properties: { category: r.category, month: r.month, year: r.month.slice(0, 2), metric: r.metric, value: r.value, sourceReport: r.sourceReport },
  });

export const toBrandShareRawRow = (r: BrandShareRow): AvcStarRow =>
  flatten({
    externalId: `${r.category}_${r.brand}_${r.priceBand}_${r.period}`,
    label: `${r.category} ${r.brand} ${r.priceBand}`,
    properties: { category: r.category, brand: r.brand, priceBand: r.priceBand, period: r.period, metric: r.metric, value: r.value, sourceReport: r.sourceReport },
  });

export const toModelMetricRawRow = (r: ModelMetricRow): AvcStarRow =>
  flatten({
    externalId: `${r.category}_${r.model}_${r.month}`,
    label: `${r.brand} ${r.model} ${r.month}`,
    properties: { category: r.category, model: r.model, brand: r.brand, heating: r.heating, launchDate: r.launchDate, reservation: r.reservation, month: r.month, valueShare: r.valueShare, volumeShare: r.volumeShare, avgPrice: r.avgPrice, sourceReport: r.sourceReport },
  });
