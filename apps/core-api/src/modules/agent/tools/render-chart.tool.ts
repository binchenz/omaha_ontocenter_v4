import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentTool, ToolContext } from './tool.interface';

@Injectable()
export class RenderChartTool implements AgentTool {
  name = 'render_chart';
  description = '在对话中渲染内联图表。根据查询结果生成可视化图表，支持折线图、柱状图、饼图、热力图等12种类型。';
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
