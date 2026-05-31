import { OntologySnapshotCodec, type OntologySnapshot } from './ontology-snapshot';

/** A captured Evals question carried by a template (de-identified — no tenant_id, no ids). */
export interface TemplateEvalQuestion {
  question: string;
  baselineTool: string;
  baselineArgs: Record<string, unknown>;
  planSummary?: string;
}

/**
 * A private, de-identified ontology template (ADR-0034): reusable business knowledge minus
 * client privacy. Carries the schema snapshot (structure, fields, relationships, semantic
 * annotations, allowedValues value sets, externalId column names) and the Evals question
 * bank. Deliberately carries NO tenant_id, NO data instances, NO connector credentials.
 */
export interface OntologyTemplate {
  name: string;
  description?: string;
  snapshot: OntologySnapshot;
  questionBank: TemplateEvalQuestion[];
}

export interface DeIdentifyInput {
  name: string;
  description?: string;
  snapshot: OntologySnapshot;
  questionBank: TemplateEvalQuestion[];
}

/**
 * De-identify an ontology snapshot + question bank into a private template (ADR-0034). Pure.
 * The line is PRIVACY, not structure: value sets (`allowedValues`) and key column names
 * (`externalId`) are industry common knowledge and are KEPT — they're the template's value.
 * What is stripped is anything client-specific: tenant_id, data instances, and connector
 * credentials never live in a snapshot to begin with, so the guarantee here is that the
 * template's shape admits none of them. Provenance tags are dropped — a template is the
 * OPC's curated knowledge, not a fresh inference to re-adjudicate.
 */
export function deIdentifyToTemplate(input: DeIdentifyInput): OntologyTemplate {
  const decoded = OntologySnapshotCodec.decode(OntologySnapshotCodec.encode(input.snapshot));

  const snapshot: OntologySnapshot = {
    version: decoded.version,
    objectTypes: decoded.objectTypes.map((t) => {
      const { provenance, externalIdCandidates, ...rest } = t;
      return {
        ...rest,
        properties: t.properties.map((p) => {
          // Keep allowedValues (knowledge); drop provenance + the unconfirmed red-flag (a
          // template's value sets are the OPC's curated knowledge, not an open question).
          const { provenance: _pp, allowedValuesUnconfirmed, ...prop } = p;
          return prop;
        }),
        derivedProperties: t.derivedProperties.map((d) => {
          const { provenance: _dp, allowedValuesUnconfirmed, ...dp } = d;
          return dp;
        }),
      };
    }),
    relationships: decoded.relationships.map((r) => {
      const { provenance, ...rel } = r;
      return rel;
    }),
  };

  return {
    name: input.name,
    description: input.description,
    snapshot,
    questionBank: input.questionBank.map((q) => ({
      question: q.question,
      baselineTool: q.baselineTool,
      baselineArgs: q.baselineArgs,
      planSummary: q.planSummary,
    })),
  };
}

/**
 * Instantiate a template into a draft snapshot (ADR-0034). Isomorphic to reverse-inference
 * output — both just "produce a draft snapshot" — so applying a template reuses the same
 * Draft-instantiation path. Pure: returns the snapshot; the service writes it to the Draft.
 */
export function instantiateTemplate(template: OntologyTemplate): OntologySnapshot {
  return OntologySnapshotCodec.decode(OntologySnapshotCodec.encode(template.snapshot));
}
