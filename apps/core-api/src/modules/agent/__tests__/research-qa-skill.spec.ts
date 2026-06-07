import { ResearchQaSkill } from '../skills/research-qa.skill';

describe('ResearchQaSkill (#139)', () => {
  let skill: ResearchQaSkill;

  beforeEach(() => {
    skill = new ResearchQaSkill();
  });

  describe('tool set', () => {
    it('includes render_chart in tools array', () => {
      expect(skill.tools).toContain('render_chart');
    });

    it('retains existing tools', () => {
      expect(skill.tools).toContain('semantic_search');
      expect(skill.tools).toContain('query_objects');
      expect(skill.tools).toContain('aggregate_objects');
      expect(skill.tools).toContain('get_ontology_schema');
    });
  });

  describe('llmOptions', () => {
    it('specifies deepseek-v4-pro model', () => {
      expect(skill.llmOptions?.model).toBe('deepseek-v4-pro');
    });

    it('enables thinking mode with effort=high', () => {
      expect(skill.llmOptions?.thinking).toEqual({ type: 'enabled' });
      expect(skill.llmOptions?.reasoningEffort).toBe('high');
    });
  });

  describe('system prompt', () => {
    const prompt = new ResearchQaSkill().systemPrompt({ tenantId: 't1' });

    it('contains chart instruction section', () => {
      expect(prompt).toContain('render_chart');
    });

    it('lists chart type selection rules', () => {
      expect(prompt).toContain('line');
      expect(prompt).toContain('bar');
      expect(prompt).toContain('stacked_bar');
      expect(prompt).toContain('kpi');
      expect(prompt).toContain('heatmap');
      expect(prompt).toContain('radar');
    });

    it('includes fallback rule for large datasets', () => {
      expect(prompt).toMatch(/500/);
    });

    it('instructs Chinese labels', () => {
      expect(prompt).toMatch(/中文/);
    });

    it('instructs textual summary after chart', () => {
      expect(prompt).toMatch(/总结|结论|洞察/);
    });
  });
});
