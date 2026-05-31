import type { Provenance } from './ontology-snapshot';

/**
 * Maps a DB column's declared SQL type to an ontology property type. Declared types are
 * hard metadata (ADR-0032): the database enforces them, so this mapping is near-zero-error.
 * The branch order matters — check the most specific families first.
 */
export function mapColumnType(dbType: string): 'string' | 'number' | 'boolean' | 'date' | 'json' {
  const t = dbType.toLowerCase();
  if (/(bool|bit)/.test(t)) return 'boolean';
  if (/(timestamp|datetime|date|time)/.test(t)) return 'date';
  if (/(int|decimal|numeric|real|double|float|money|serial)/.test(t)) return 'number';
  if (/(json|jsonb)/.test(t)) return 'json';
  // char/varchar/text/uuid/enum and anything else → string (incl. phone/zip: declared
  // varchar must stay string even though the values look numeric).
  return 'string';
}

export type FieldInferenceBasis =
  | { kind: 'declared-type' } // column type from information_schema → metadata
  | { kind: 'fk-relationship' } // relationship backed by a FOREIGN KEY constraint → metadata
  | { kind: 'naming-relationship' } // relationship guessed from an xxx_id column name, no FK → heuristic
  | { kind: 'sampled-allowed-values' } // allowedValues from scanning distinct values → heuristic
  | { kind: 'unique-column' } // a UNIQUE-indexed column offered as an externalId key → candidate
  | { kind: 'llm-annotation' }; // description/unit inferred by the LLM → heuristic

/**
 * The honesty core of reverse-inference (ADR-0032): classify each inference as `metadata`
 * (hard — a DB-enforced constraint), `heuristic` (guessed — a semantic interpretation), or
 * `candidate` (feasible-but-not-intent). Pure and total over the basis union, so the rule
 * table is the single source of truth and every branch is unit-tested.
 *
 * Rule of thumb: a constraint the database ENFORCES is metadata; a semantic INTERPRETATION
 * of what the data means is heuristic; a constraint that proves feasibility but not intent
 * (a unique column "can be" a key but may not be THE business key) is candidate.
 */
export function classifyProvenance(basis: FieldInferenceBasis): Provenance {
  switch (basis.kind) {
    case 'declared-type':
    case 'fk-relationship':
      return 'metadata';
    case 'naming-relationship':
    case 'sampled-allowed-values':
    case 'llm-annotation':
      return 'heuristic';
    case 'unique-column':
      return 'candidate';
  }
}
