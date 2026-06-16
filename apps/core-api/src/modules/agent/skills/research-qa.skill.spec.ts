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

  it('keeps the system prompt lean: the 12-chart-type catalogue lives on the render_chart tool, not in skill prose (#197)', () => {
    // The chart-type enumeration (stacked_bar/grouped_bar/waterfall/radar/…) was ~1/4 of this
    // skill's 10.5KB prose, injected every market-query turn. It belongs in render_chart's own
    // tool description (loaded only when the model considers charting), not here.
    const prompt = skill.systemPrompt({ tenantId: 't1' });
    const chartTypeTokens = ['stacked_bar', 'grouped_bar', 'stacked_area', 'waterfall', 'radar'];
    const present = chartTypeTokens.filter((t) => prompt.includes(t));
    expect(present).toEqual([]); // none of the low-level chart-type identifiers remain in prose
  });

  it('teaches that a brand TOTAL share lives in the 整体 band, never a cross-band SUM (#201)', () => {
    // The eval caught the Agent computing "纯米 total share" by SUM(value) across all price bands
    // (blocked by the ADR-0061 additivity guard → NON_ADDITIVE_SUM), then thrashing on raw-row
    // manual summation until the soft budget punted (S6/S7). The 整体 band IS the pre-summed total;
    // the skill must say: filter priceBand=整体, do NOT sum across bands.
    const prompt = skill.systemPrompt({ tenantId: 't1' });
    expect(prompt).toContain('整体');
    // names the anti-pattern: cross-band SUM of share is forbidden / will be rejected
    expect(prompt).toMatch(/(跨价格段|跨段|各价格段).*(求和|相加|SUM|加总)|不可加/i);
    // and that the 整体 row already is the aggregate total
    expect(prompt).toMatch(/整体.*(总份额|已.*汇总|全段|跨段汇总|合计)|(总份额|总的份额).*整体/);
  });

  it('teaches a multi-period trend is ONE groupBy[period] aggregate, not per-period queries (#201/FIX-6)', () => {
    // S4 used 18 tool_calls for a 5-period trend by querying each period separately. A trend is a
    // single aggregate groupBy[period]; the skill must steer to that, not period-by-period.
    const prompt = skill.systemPrompt({ tenantId: 't1' });
    expect(prompt).toMatch(/(趋势|多期|各期|历年).*(一次|单次|groupBy\s*\[?\s*period)/i);
  });

  it('enforces universe discipline: price-band/share questions use brand_share, not model_metric SKU buckets (#196)', () => {
    // The eval caught the Agent answering a whole-market price-band question with
    // model_metric (TOP-100 SKU avgPrice buckets), declaring "400-600 真空" when
    // brand_share shows 0.66% there. A TOP-100 sampling gap is NOT a whole-market
    // vacuum. The skill must say so explicitly.
    const prompt = skill.systemPrompt({ tenantId: 't1' });
    expect(prompt).toMatch(/brand_share/);
    // The specific trap, stated as one rule: a TOP-100 sample's empty price band
    // must NOT be reported as a whole-market vacuum/zero.
    expect(prompt).toMatch(/(抽样|样本|TOP-?100)[^。]*(真空|空白|为零|不等于|≠|缺口)|(真空|空白|为零)[^。]*(抽样|样本|TOP-?100)/);
  });

  it('forbids calling a low-but-nonzero price band a "vacuum/abandon" without checking its share (#204)', () => {
    // #196 fixed universe ROUTING (use brand_share). But the eval found the WORDING judgment still
    // wobbles: S2.turn2 called the 0.66% 400-500 band "真空", while S9 (same band) did not. The
    // skill must require checking the band's actual share before any 真空/放弃 claim, and reserve
    // "真空/为零" for genuinely empty bands — a >0 band is "份额低", not "真空".
    const prompt = skill.systemPrompt({ tenantId: 't1' });
    expect(prompt).toMatch(/(真空|空白|放弃|为零)[^。]*(实际份额|该段份额|回看|核对|先查|大于\s*0|>\s*0)|(实际份额|该段份额|回看|先查)[^。]*(真空|空白|放弃|为零)/);
    expect(prompt).toMatch(/份额低|低份额/); // the allowed wording for a >0 weak band
  });

});
