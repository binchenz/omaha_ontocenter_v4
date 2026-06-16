import { ResearchQaSkill } from './research-qa.skill';

describe('ResearchQaSkill', () => {
  const skill = new ResearchQaSkill();

  it('exposes both read paths so a fused query reaches them in one turn', () => {
    // The fused query (number + narrative) needs the structured read path AND
    // semantic search co-present; the orchestrator scopes tools to the union of
    // the assembled skills' tools, so research_qa must carry both itself.
    expect(skill.tools).toContain('semantic_search');
    expect(skill.tools).toContain('aggregate_objects');
    expect(skill.tools).toContain('query_objects');
  });

  it('teaches citation-grounded answering (provenance is a floor, not optional)', () => {
    const prompt = skill.systemPrompt({ tenantId: 't1' });
    expect(prompt).toContain('出处');
    expect(prompt).toContain('semantic_search');
  });

  it('teaches the fused number + narrative pattern on the shared 品类 spine', () => {
    const prompt = skill.systemPrompt({ tenantId: 't1' });
    expect(prompt).toContain('融合');
    expect(prompt).toMatch(/market_metric|brand_share/);
    expect(prompt).toContain('品类');
  });

  it('teaches that year is a trustworthy same-source dimension — no month-exhaustion re-verify (#178)', () => {
    // ADR-0059 added a stored `year` derived in lockstep with `month`. The Agent
    // was distrusting it: after a correct groupBy[year] it would re-verify by
    // exhausting month in [...] (24 months), burning ~50% more tool_calls. The
    // skill must vouch for `year` so a yearly rollup converges in one aggregate.
    const prompt = skill.systemPrompt({ tenantId: 't1' });
    expect(prompt).toContain('year');
    expect(prompt).toMatch(/同源/);            // year 与 month 同源
    expect(prompt).toMatch(/可信|可靠|信任/);   // trustworthy
    expect(prompt).toMatch(/穷举|逐月|复核|月份再验|month\s*in/i); // names the anti-pattern to avoid
  });

  it('enforces the stop-and-confirm checkpoint before cross-star drill-down (ADR-0049)', () => {
    // ①② are single-star (reliable). ③④ are cross-star, where the Agent's
    // query-plan translation fails 50-100% per question. The skill must stop
    // before ③④ and hand the price-band parameters to the user for confirmation
    // rather than chaining all four hops in one opaque reply.
    const prompt = skill.systemPrompt({ tenantId: 't1' });
    expect(prompt).toContain('执行前停下来');
    expect(prompt).toContain('用户确认后执行');
    expect(prompt).toMatch(/是否继续钻取/);
  });

});
