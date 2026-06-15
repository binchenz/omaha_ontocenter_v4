import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { PipelineService, ConfigureStepDto } from './pipeline.service';
import { TransformConfigService } from '../transform-config/transform-config.service';
import { OntologyService } from '../ontology/ontology.service';
import {
  MARKET_METRIC_DEF,
  BRAND_SHARE_DEF,
  MODEL_METRIC_DEF,
} from '../research/market-metric-importer.service';

/**
 * Provisions the three fixed AVC pipelines per tenant (#174, ADR-0055 Step 2).
 *
 * The configs are fixed (not user input), so this is scripted rather than authored by hand.
 * All three pipelines are created with status='draft' — provisioned but NOT activated, so the
 * live importStar AVC path is untouched until the cutover (#175). Idempotent: keyed off the
 * (tenant, connector, outputObjectType) uniqueness, a re-run creates nothing.
 *
 * PER-STAR CONNECTORS (ADR-0055 routing amendment): each star gets its OWN connector, so
 * onRawDatasetReady resolves exactly one active pipeline per connector. A single shared
 * avc_excel connector would fan a market raw Dataset into the brand/model pipelines too
 * (their compute steps reference fields the market rows lack), silently corrupting the run.
 *
 *   Pipeline 1: avc_market_excel → market_metric   (filter out invalid/zero rows)
 *   Pipeline 2: avc_brand_excel  → brand_share      (normalize_brand via avc_brands TransformConfig)
 *   Pipeline 3: avc_model_excel  → model_metric     (pass-through — no price_band step, ADR-0056)
 */
@Injectable()
export class AvcPipelineProvisioner {
  private readonly logger = new Logger(AvcPipelineProvisioner.name);

  static readonly BRAND_CONFIG = 'avc_brands';

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipelineService: PipelineService,
    private readonly transformConfigService: TransformConfigService,
    private readonly ontologyService: OntologyService,
  ) {}

  async provision(tenantId: string): Promise<{ created: string[]; skipped: string[] }> {
    // 1. Seed the brand_mapping TransformConfig (skip if already present).
    await this.ensureTransformConfig(tenantId, AvcPipelineProvisioner.BRAND_CONFIG, 'brand_mapping', {
      mappings: {},
    });

    // 2. Provision one connector + one pipeline per star.
    const specs = this.pipelineSpecs();

    const created: string[] = [];
    const skipped: string[] = [];
    for (const spec of specs) {
      // Per-star connector: reuse if present, create otherwise (keyed by connector type).
      const connector = await this.ensureConnector(tenantId, spec.connectorType, spec.connectorName);
      // Ensure the output ObjectType exists (gap #2) + an identity ObjectMapping (gap #1) so the
      // reactive SyncJob can land clean rows. Both are idempotent.
      const outputObjectTypeId = await this.ensureObjectTypeId(tenantId, spec.def);
      await this.ensureMapping(tenantId, connector.id, outputObjectTypeId, spec.propertyMappings);

      // Idempotency: a pipeline is unique per (tenant, connector, outputObjectType).
      const existing = await this.prisma.pipeline.findFirst({
        where: { tenantId, connectorId: connector.id, outputObjectTypeId },
      });
      if (existing) {
        skipped.push(spec.name);
        continue;
      }

      await this.pipelineService.configurePipeline(tenantId, {
        name: spec.name,
        connectorId: connector.id,
        outputObjectTypeId,
        steps: spec.steps,
        autoActivate: true, // Cutover complete (Phase 5) — activate immediately so markReady triggers runs
      });
      created.push(spec.name);
    }

    this.logger.log(
      `AVC pipelines for tenant=${tenantId}: created=[${created.join(', ')}] skipped=[${skipped.join(', ')}]`,
    );
    return { created, skipped };
  }

  /**
   * Activate the AVC pipelines (#175, ADR-0055 Step 4 — the breaking flip). Flips the draft
   * pipelines created by provision() to status='active' so onRawDatasetReady picks them up and
   * the reactive chain becomes the live AVC path. Idempotent: only draft pipelines are flipped.
   *
   * HITL: this is the step that makes the new path live. Run after provision() + an end-to-end
   * validation upload, and only once the legacy importStar path has been retired (Step 5).
   */
  async activate(tenantId: string): Promise<{ activated: string[] }> {
    const names = this.pipelineSpecs().map((s) => s.name);
    const drafts = await this.prisma.pipeline.findMany({
      where: { tenantId, name: { in: names }, status: 'draft' },
    });
    const activated: string[] = [];
    for (const p of drafts) {
      await this.prisma.pipeline.update({ where: { id: p.id }, data: { status: 'active' } });
      activated.push(p.name);
    }
    this.logger.log(`AVC pipelines activated for tenant=${tenantId}: [${activated.join(', ')}]`);
    return { activated };
  }

  private async ensureConnector(tenantId: string, type: string, name: string) {
    const existing = await this.prisma.connector.findFirst({
      where: { tenantId, type },
    });
    if (existing) return existing;
    return this.prisma.connector.create({
      data: { tenantId, name, type, status: 'active', config: {} },
    });
  }

  private async ensureTransformConfig(
    tenantId: string,
    name: string,
    type: 'brand_mapping',
    config: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.transformConfigService.get(tenantId, name);
      return; // already seeded — leave existing (possibly hand-curated) versions untouched
    } catch {
      await this.transformConfigService.create(tenantId, { name, type, config });
    }
  }

  /**
   * Ensure the star ObjectType exists, returning its id. Gap #2 (cutover): importStar used to
   * create these lazily, but the Pipeline write path (SyncJobWorker → ImportEngine) requires the
   * ObjectType to pre-exist. The DEF is the same one the importer historically used.
   */
  private async ensureObjectTypeId(tenantId: string, def: { name: string }): Promise<string> {
    const existing = await this.prisma.objectType.findFirst({ where: { tenantId, name: def.name } });
    if (existing) return existing.id;
    const created = await this.ontologyService.createObjectType(tenantId, def as any);
    return created.id;
  }

  /**
   * Ensure an identity ObjectMapping binding the star's per-star connector to its ObjectType.
   * Gap #1 (cutover): onPipelineRunComplete looks up the mapping by (tenant, connectorId,
   * outputObjectTypeId); without it the clean rows silently never reach object_instances.
   * Property map is identity — the clean Dataset columns share the ObjectType property names
   * (externalId/label are handled by the SyncJobWorker, not the property map).
   */
  private async ensureMapping(
    tenantId: string,
    connectorId: string,
    objectTypeId: string,
    propertyMappings: Record<string, string>,
  ): Promise<void> {
    const existing = await this.prisma.objectMapping.findFirst({
      where: { tenantId, connectorId, objectTypeId },
    });
    if (existing) return;
    await this.prisma.objectMapping.create({
      data: { tenantId, connectorId, objectTypeId, propertyMappings },
    });
  }

  /**
   * The three fixed pipeline specs (ADR-0055 Step 2 + routing amendment). Each star carries its
   * OWN connector type/name so onRawDatasetReady resolves exactly one active pipeline per connector.
   */
  private pipelineSpecs(): Array<{
    name: string;
    objectType: string;
    connectorType: string;
    connectorName: string;
    def: Parameters<OntologyService['createObjectType']>[1];
    /** Identity property map: each clean-Dataset column → same-named object property (gap #1). */
    propertyMappings: Record<string, string>;
    steps: ConfigureStepDto[];
  }> {
    return [
      {
        name: 'avc_market_metric',
        objectType: 'market_metric',
        connectorType: 'avc_market_excel',
        connectorName: 'AVC 市场指标',
        def: MARKET_METRIC_DEF,
        propertyMappings: identityMap(MARKET_METRIC_DEF),
        steps: [
          // Drop rows with no metric value (invalid/blank monitoring cells).
          { order: 1, type: 'filter', config: { field: 'value', operator: 'gt', value: 0 } },
        ],
      },
      {
        name: 'avc_brand_share',
        objectType: 'brand_share',
        connectorType: 'avc_brand_excel',
        connectorName: 'AVC 品牌份额',
        def: BRAND_SHARE_DEF,
        propertyMappings: identityMap(BRAND_SHARE_DEF),
        steps: [
          {
            order: 1,
            type: 'compute',
            config: {
              function: 'normalize_brand',
              inputField: 'brand',
              outputField: 'brand',
              configRef: AvcPipelineProvisioner.BRAND_CONFIG,
            },
          },
        ],
      },
      {
        name: 'avc_model_metric',
        objectType: 'model_metric',
        connectorType: 'avc_model_excel',
        connectorName: 'AVC 机型指标',
        def: MODEL_METRIC_DEF,
        propertyMappings: identityMap(MODEL_METRIC_DEF),
        steps: [],
      },
    ];
  }
}

/** Build an identity property map ({ prop: prop }) from an ObjectType DEF's properties. */
function identityMap(def: { properties: Array<{ name: string }> }): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of def.properties) map[p.name] = p.name;
  return map;
}
