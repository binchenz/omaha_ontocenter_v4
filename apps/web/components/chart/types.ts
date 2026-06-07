/** Chart spec types — matches the render_chart tool's strict schema (ADR-0047). */

export type ChartType =
  | 'line' | 'bar' | 'stacked_bar' | 'grouped_bar' | 'pie'
  | 'area' | 'stacked_area' | 'scatter' | 'heatmap'
  | 'kpi' | 'waterfall' | 'radar';

export interface AxisDef {
  key: string;
  label: string;
  unit?: string;
}

export interface SeriesItem {
  name: string;
  data: Record<string, unknown>[];
}

export interface KpiItem {
  label: string;
  value: string;
  change?: string;
  trend?: 'up' | 'down' | 'flat';
}

export interface MatrixData {
  xLabels: string[];
  yLabels: string[];
  values: number[][];
}

export interface RadarAxisDef {
  axis: string;
  max?: number;
}

export interface ChartSpec {
  type: ChartType;
  title: string;
  xAxis?: AxisDef;
  yAxis?: AxisDef;
  series?: SeriesItem[];
  kpis?: KpiItem[];
  matrix?: MatrixData;
  axes?: RadarAxisDef[];
}
