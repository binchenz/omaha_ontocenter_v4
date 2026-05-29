import { QuerySkill } from '../query.skill';
import { DataIngestionSkill } from '../data-ingestion.skill';
import { OntologyDesignSkill } from '../ontology-design.skill';
import type { AgentSkill, SkillContext } from '../skill.interface';

const ctx: SkillContext = { tenantId: 'tenant-1', userMessage: 'show me orders' };

describe('Skill contract tests', () => {
  const skills: AgentSkill[] = [new QuerySkill(), new DataIngestionSkill(), new OntologyDesignSkill()];

  for (const skill of skills) {
    describe(`${skill.name}`, () => {
      it('has a non-empty name', () => {
        expect(skill.name.length).toBeGreaterThan(0);
      });

      it('has at least one tool', () => {
        expect(skill.tools.length).toBeGreaterThan(0);
      });

      it('systemPrompt returns a non-empty string', () => {
        const prompt = skill.systemPrompt(ctx);
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(0);
      });
    });
  }

  describe('QuerySkill', () => {
    const qs = new QuerySkill();

    it('tools include query_objects, aggregate_objects, get_ontology_schema', () => {
      expect(qs.tools).toContain('query_objects');
      expect(qs.tools).toContain('aggregate_objects');
      expect(qs.tools).toContain('get_ontology_schema');
    });
  });
});
