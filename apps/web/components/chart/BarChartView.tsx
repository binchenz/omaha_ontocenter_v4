'use client';

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ChartSpec } from './types';
import { COLORS, mergeSeriesData } from './chart-utils';

interface BarChartViewProps {
  spec: ChartSpec;
  variant: 'single' | 'stacked' | 'grouped';
}

export function BarChartView({ spec, variant }: BarChartViewProps) {
  const data = mergeSeriesData(spec.series ?? [], spec.xAxis?.key ?? 'x');
  const stackId = variant === 'stacked' ? 'stack' : undefined;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={spec.xAxis?.key ?? 'x'} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} label={spec.yAxis?.label ? { value: spec.yAxis.label, angle: -90, position: 'insideLeft', style: { fontSize: 12 } } : undefined} />
        <Tooltip />
        <Legend />
        {(spec.series ?? []).map((s, i) => (
          <Bar key={s.name} dataKey={s.name} fill={COLORS[i % COLORS.length]} stackId={stackId} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
