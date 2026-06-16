import { QuerySkill } from './query.skill';

describe('QuerySkill', () => {
  const skill = new QuerySkill();
  const prompt = skill.systemPrompt({ tenantId: 't1' });

  it('teaches choosing query vs aggregate by question shape', () => {
    expect(prompt).toContain('query_objects');
    expect(prompt).toContain('aggregate_objects');
  });

  it('teaches cross-relationship aggregation with a domain-neutral example (#197)', () => {
    // The cross-rel example used to be drama-specific (镜头数 / episode_shots.series / shotCount),
    // irrelevant to non-drama tenants like the AVC market-intelligence tenant and pure token cost.
    // The teaching must survive in domain-neutral terms.
    expect(prompt).toMatch(/跨关系|父对象|子对象|dot-path/);
    expect(prompt).not.toContain('镜头');
    expect(prompt).not.toContain('episode_shots');
    expect(prompt).not.toContain('shotCount');
    expect(prompt).not.toMatch(/每部剧/);
  });

  it('teaches strict 含/不含 boundary mapping for filters', () => {
    expect(prompt).toMatch(/gte/);
    expect(prompt).toMatch(/大于|小于|至少|不超过/);
  });
});
