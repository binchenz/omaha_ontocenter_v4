import { assembleSkills, openingGuidanceFor } from './skill-assembly';
import { AgentSkill, SkillContext } from '../agent/skills/skill.interface';

function skill(name: string, tools: string[]): AgentSkill {
  return { name, description: name, tools, systemPrompt: (_c: SkillContext) => name };
}

const QUERY = skill('query', ['query_objects', 'aggregate_objects', 'get_ontology_schema']);
const INGEST = skill('data_ingestion', ['parse_file', 'create_object_type', 'import_data']);
const DESIGN = skill('ontology_design', ['get_ontology_schema', 'create_object_type', 'update_object_type']);
const ALL = [QUERY, INGEST, DESIGN];

describe('assembleSkills', () => {
  it('loads only the query skill on the consume surface', () => {
    const result = assembleSkills(ALL, 'consume', ['object.query']);
    expect(result.map((s) => s.name)).toEqual(['query']);
  });

  it('loads the ontology-design skill on the maintain surface', () => {
    const result = assembleSkills(ALL, 'maintain', ['ontology.design']);
    expect(result.map((s) => s.name)).toEqual(['ontology_design']);
  });

  it('withholds the design skill when the surface wants it but permissions do not authorize it', () => {
    // A query-only user who somehow lands on the maintain surface gets no design skill.
    const result = assembleSkills(ALL, 'maintain', ['object.query']);
    expect(result.map((s) => s.name)).not.toContain('ontology_design');
  });

  describe('no declared surface → budget-safe fallback (#179)', () => {
    const RESEARCH = skill('research_qa', ['semantic_search', 'query_objects']);
    const FULL = [QUERY, INGEST, DESIGN, RESEARCH];

    it('falls back to the consume skill set, NOT the full union, when no surface is declared', () => {
      // The full 6-skill union blows the prompt budget (#179). With no surface, a
      // design-time user gets the safe CONSUME set rather than everything.
      const result = assembleSkills(FULL, undefined, ['ontology.design', 'object.query']);
      expect(result.map((s) => s.name).sort()).toEqual(['query', 'research_qa']);
    });

    it('still withholds design-time skills on the fallback for a query-only user', () => {
      const result = assembleSkills(FULL, undefined, ['object.query']);
      expect(result.map((s) => s.name)).not.toContain('ontology_design');
      expect(result.map((s) => s.name)).not.toContain('data_ingestion');
    });

    it('treats an unknown surface the same as no surface (safe fallback, not union)', () => {
      const result = assembleSkills(FULL, 'totally-unknown', ['ontology.design']);
      expect(result.map((s) => s.name).sort()).toEqual(['query', 'research_qa']);
    });
  });
});

describe('openingGuidanceFor', () => {
  it('produces guidance when a query-only user is on a design surface', () => {
    const guidance = openingGuidanceFor('maintain', ['object.query']);
    expect(guidance).toBeTruthy();
  });

  it('produces no guidance for a design-time user on a design surface', () => {
    const guidance = openingGuidanceFor('maintain', ['ontology.design']);
    expect(guidance).toBeNull();
  });

  it('produces no guidance on the consume surface', () => {
    expect(openingGuidanceFor('consume', ['object.query'])).toBeNull();
  });
});
