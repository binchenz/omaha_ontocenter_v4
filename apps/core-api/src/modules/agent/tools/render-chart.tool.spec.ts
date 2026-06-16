import { RenderChartTool } from './render-chart.tool';

describe('RenderChartTool', () => {
  const tool = new RenderChartTool();

  // #197 — the 12-chart-type catalogue moved out of the research-qa skill prose (常驻 system
  // prompt) into this tool's own description, which only enters context when the model considers
  // charting. The description must therefore carry enough chart-type guidance to choose a type.
  it('carries chart-type selection guidance in its description (moved from skill prose)', () => {
    expect(tool.description).toMatch(/line|折线/);
    expect(tool.description).toMatch(/bar|柱/);
    expect(tool.description).toMatch(/pie|饼/);
    // at least a few of the less-obvious types are named so the model can pick them
    const advanced = ['stacked_bar', 'waterfall', 'radar', 'heatmap', 'kpi'].filter((t) => tool.description.includes(t));
    expect(advanced.length).toBeGreaterThanOrEqual(3);
  });

  it('still enumerates all 12 types in the parameter enum (unchanged contract)', () => {
    const params = tool.parameters as any;
    expect(params.properties.type.enum).toHaveLength(12);
  });
});
