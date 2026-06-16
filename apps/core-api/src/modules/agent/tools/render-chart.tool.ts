import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentTool, ToolContext } from './tool.interface';

@Injectable()
export class RenderChartTool implements AgentTool {
  name = 'render_chart';
  // The chart-type catalogue lives here (not in skill prose) so it only enters the model's
  // context when render_chart is actually under consideration — keeping the常驻 system prompt lean
  // (#197). Each type names its best-fit scenario so the model can select without extra prose.
  description = [
    '在对话中渲染内联图表。先用 aggregate_objects/query_objects 取数，再调本工具；标题与坐标轴用中文。',
    '图表类型选型：',
    '- line：时间序列趋势（月度销量/销额走势）',
    '- bar：排名对比（TOP10 品牌销量）',
    '- stacked_bar：构成/份额分解（各价格段品牌份额）',
    '- grouped_bar：多维对比（A品牌 vs B品牌 按月）',
    '- pie：整体占比分布（品牌份额分布）',
    '- area：趋势+体积感（市场总量走势）',
    '- stacked_area：构成随时间变化（各品牌份额演变）',
    '- scatter：相关性（价格 vs 销量）',
    '- heatmap：矩阵交叉（品牌×价格段份额矩阵）',
    '- kpi：单一/关键指标概览（市场规模、增速）；单标量值用 kpi 而非 line/bar',
    '- waterfall：增量分解归因（份额变化来源）',
    '- radar：多维评估（品牌综合竞争力）',
  ].join('\n');
  requiresConfirmation = false;

  parameters: Record<string, unknown> = {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['line', 'bar', 'stacked_bar', 'grouped_bar', 'pie', 'area', 'stacked_area', 'scatter', 'heatmap', 'kpi', 'waterfall', 'radar'],
        description: '图表类型',
      },
      title: {
        type: 'string',
        description: '图表标题（中文）',
      },
      xAxis: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '数据中对应X轴的字段名' },
          label: { type: 'string', description: 'X轴标签' },
        },
        required: ['key', 'label'],
        additionalProperties: false,
      },
      yAxis: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '数据中对应Y轴的字段名' },
          label: { type: 'string', description: 'Y轴标签' },
          unit: { type: 'string', description: '单位（如 万元、%）' },
        },
        required: ['key', 'label', 'unit'],
        additionalProperties: false,
      },
      series: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '系列名称（如品牌名）' },
            data: {
              type: 'array',
              items: {},
              description: '数据点数组，每个元素是一个对象',
            },
          },
          required: ['name', 'data'],
          additionalProperties: false,
        },
        description: '数据系列（适用于 line/bar/stacked_bar/grouped_bar/area/stacked_area/scatter/radar）',
      },
      kpis: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: '指标名称' },
            value: { type: 'string', description: '指标值（已格式化）' },
            change: { type: 'string', description: '变化幅度（如 +3.2%）' },
            trend: { type: 'string', enum: ['up', 'down', 'flat'], description: '趋势方向' },
          },
          required: ['label', 'value', 'change', 'trend'],
          additionalProperties: false,
        },
        description: 'KPI 指标卡数据（仅 type=kpi 时使用）',
      },
      matrix: {
        type: 'object',
        properties: {
          xLabels: { type: 'array', items: { type: 'string' }, description: '列标签' },
          yLabels: { type: 'array', items: { type: 'string' }, description: '行标签' },
          values: {
            type: 'array',
            items: { type: 'array', items: { type: 'number' } },
            description: '二维数值矩阵（行×列）',
          },
        },
        required: ['xLabels', 'yLabels', 'values'],
        additionalProperties: false,
        description: '热力图矩阵数据（仅 type=heatmap 时使用）',
      },
      axes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            axis: { type: 'string', description: '维度名称' },
            max: { type: 'number', description: '该维度最大值' },
          },
          required: ['axis', 'max'],
          additionalProperties: false,
        },
        description: '雷达图维度定义（仅 type=radar 时使用）',
      },
    },
    required: ['type', 'title', 'xAxis', 'yAxis', 'series', 'kpis', 'matrix', 'axes'],
    additionalProperties: false,
  };

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    return { rendered: true, chartId: randomUUID() };
  }
}
