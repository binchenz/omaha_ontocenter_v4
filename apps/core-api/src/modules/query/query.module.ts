import { Module } from '@nestjs/common';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';
import { QueryPlannerService } from './query-planner.service';
import { DimensionConstraintEnforcer } from './dimension-constraint-enforcer';
import { OntologyModule } from '../ontology/ontology.module';
import { ProvenanceGate, PROVENANCE_GATE_REGISTRY } from './provenance-gate.service';
import {
  MARKET_METRIC_TYPE,
  BRAND_SHARE_TYPE,
  MODEL_METRIC_TYPE,
} from '../research/market-metric-importer.service';

/** Code-defined registry of star types that require a provenance-gate check (ADR-0044). */
const COVERAGE_GATE_REGISTRY = [
  { objectType: MARKET_METRIC_TYPE, provenanceType: 'avc_report', categoryField: 'category', periodField: 'month',  modelLayer: false },
  { objectType: BRAND_SHARE_TYPE,   provenanceType: 'avc_report', categoryField: 'category', periodField: 'period', modelLayer: false },
  { objectType: MODEL_METRIC_TYPE,  provenanceType: 'avc_report', categoryField: 'category', periodField: 'month',  modelLayer: true  },
];

@Module({
  imports: [OntologyModule],
  controllers: [QueryController],
  providers: [
    QueryService,
    QueryPlannerService,
    DimensionConstraintEnforcer,
    ProvenanceGate,
    { provide: PROVENANCE_GATE_REGISTRY, useValue: COVERAGE_GATE_REGISTRY },
  ],
  exports: [QueryService],
})
export class QueryModule {}
