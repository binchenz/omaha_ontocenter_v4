import { RenderChartTool } from '../tools/render-chart.tool';

describe('RenderChartTool (#138)', () => {
  let tool: RenderChartTool;

  beforeEach(() => {
    tool = new RenderChartTool();
  });

  describe('metadata', () => {
    it('has correct name', () => {
      expect(tool.name).toBe('render_chart');
    });

    it('does not require confirmation', () => {
      expect(tool.requiresConfirmation).toBe(false);
    });

    it('schema has strict-compliant root', () => {
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.parameters.type).toBe('object');
      expect(Array.isArray(tool.parameters.required)).toBe(true);
    });

    it('schema type enum contains all 12 chart types', () => {
      const props = tool.parameters.properties as any;
      expect(props.type.enum).toEqual(
        expect.arrayContaining([
          'line', 'bar', 'stacked_bar', 'grouped_bar', 'pie',
          'area', 'stacked_area', 'scatter', 'heatmap', 'kpi',
          'waterfall', 'radar',
        ]),
      );
      expect(props.type.enum).toHaveLength(12);
    });
  });

  describe('execute', () => {
    it('returns rendered: true with a chartId for a line chart', async () => {
      const result = await tool.execute({
        type: 'line',
        title: '品牌甲电饭煲近6个月零售额趋势',
        xAxis: { key: 'month', label: '月份' },
        yAxis: { key: 'value', label: '零售额(万元)' },
        series: [
          { name: '品牌甲', data: [{ month: '2025-12', value: 1200 }, { month: '2026-01', value: 1350 }] },
        ],
      }, { user: {} as any });

      expect(result).toMatchObject({ rendered: true });
      expect((result as any).chartId).toBeDefined();
      expect(typeof (result as any).chartId).toBe('string');
      expect((result as any).chartId.length).toBeGreaterThan(0);
    });

    it('returns rendered: true for a kpi chart', async () => {
      const result = await tool.execute({
        type: 'kpi',
        title: '市场概览',
        kpis: [
          { label: '市场规模', value: '12.3亿', change: '+3.2%', trend: 'up' },
          { label: '品牌集中度', value: '68%', trend: 'flat' },
        ],
      }, { user: {} as any });

      expect(result).toMatchObject({ rendered: true });
      expect((result as any).chartId).toBeDefined();
    });

    it('returns rendered: true for a heatmap chart', async () => {
      const result = await tool.execute({
        type: 'heatmap',
        title: '品牌×价格段份额矩阵',
        matrix: {
          xLabels: ['<200', '200-400', '400-600'],
          yLabels: ['品牌甲', '九阳', '美的'],
          values: [[10, 25, 15], [20, 30, 10], [15, 20, 25]],
        },
      }, { user: {} as any });

      expect(result).toMatchObject({ rendered: true });
      expect((result as any).chartId).toBeDefined();
    });

    it('returns rendered: true for a radar chart', async () => {
      const result = await tool.execute({
        type: 'radar',
        title: '品牌竞争力',
        axes: [
          { axis: '价格', max: 100 },
          { axis: '份额', max: 100 },
          { axis: '增速', max: 100 },
        ],
        series: [
          { name: '品牌甲', data: [{ axis: '价格', value: 70 }, { axis: '份额', value: 45 }, { axis: '增速', value: 80 }] },
        ],
      }, { user: {} as any });

      expect(result).toMatchObject({ rendered: true });
    });

    it('generates unique chartId per invocation', async () => {
      const r1 = await tool.execute({ type: 'bar', title: 'A', series: [] }, { user: {} as any });
      const r2 = await tool.execute({ type: 'bar', title: 'B', series: [] }, { user: {} as any });
      expect((r1 as any).chartId).not.toBe((r2 as any).chartId);
    });
  });
});
