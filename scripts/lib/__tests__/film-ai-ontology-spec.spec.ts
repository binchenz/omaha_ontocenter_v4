import { describe, it, expect } from 'vitest';
import { filmAiOntologySpec } from '../film-ai-ontology-spec';

describe('film-ai-ontology-spec', () => {
  it('every Relationship references ObjectTypes that exist in the spec', () => {
    const typeNames = new Set(filmAiOntologySpec.objectTypes.map((t) => t.name));
    const missing: string[] = [];
    for (const r of filmAiOntologySpec.relationships) {
      if (!typeNames.has(r.sourceType)) missing.push(`relationship ${r.name}: sourceType=${r.sourceType}`);
      if (!typeNames.has(r.targetType)) missing.push(`relationship ${r.name}: targetType=${r.targetType}`);
    }
    expect(missing).toEqual([]);
  });

  it('relationship names are unique within the same sourceType (matches DB unique constraint)', () => {
    const seen = new Map<string, Set<string>>();
    const dupes: string[] = [];
    for (const r of filmAiOntologySpec.relationships) {
      const set = seen.get(r.sourceType) ?? new Set<string>();
      if (set.has(r.name)) dupes.push(`${r.sourceType}.${r.name} duplicated`);
      set.add(r.name);
      seen.set(r.sourceType, set);
    }
    expect(dupes).toEqual([]);
  });
});
