'use client';

import { ChartSpec } from './types';
import { LineChartView } from './LineChartView';
import { BarChartView } from './BarChartView';
import { PieChartView } from './PieChartView';
import { AreaChartView } from './AreaChartView';
import { ScatterChartView } from './ScatterChartView';
import { RadarChartView } from './RadarChartView';
import { HeatmapView } from './HeatmapView';
import { KpiCardView } from './KpiCardView';
import { WaterfallChartView } from './WaterfallChartView';

interface ChartRendererProps {
  spec: ChartSpec;
}

export function ChartRenderer({ spec }: ChartRendererProps) {
  return (
    <div className="w-full rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-medium text-gray-900">{spec.title}</h3>
      <div className="w-full" style={{ minHeight: 300 }}>
        <ChartBody spec={spec} />
      </div>
    </div>
  );
}

function ChartBody({ spec }: { spec: ChartSpec }) {
  try {
    switch (spec.type) {
      case 'line':
        return <LineChartView spec={spec} />;
      case 'bar':
        return <BarChartView spec={spec} variant="single" />;
      case 'stacked_bar':
        return <BarChartView spec={spec} variant="stacked" />;
      case 'grouped_bar':
        return <BarChartView spec={spec} variant="grouped" />;
      case 'pie':
        return <PieChartView spec={spec} />;
      case 'area':
        return <AreaChartView spec={spec} stacked={false} />;
      case 'stacked_area':
        return <AreaChartView spec={spec} stacked={true} />;
      case 'scatter':
        return <ScatterChartView spec={spec} />;
      case 'heatmap':
        return <HeatmapView spec={spec} />;
      case 'kpi':
        return <KpiCardView spec={spec} />;
      case 'waterfall':
        return <WaterfallChartView spec={spec} />;
      case 'radar':
        return <RadarChartView spec={spec} />;
      default:
        return <div className="text-sm text-gray-500">不支持的图表类型: {(spec as any).type}</div>;
    }
  } catch (e) {
    return (
      <div className="flex items-center justify-center h-[300px] text-sm text-red-500">
        图表渲染失败: {(e as Error).message}
      </div>
    );
  }
}
