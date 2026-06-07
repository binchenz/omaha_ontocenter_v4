'use client';

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ChartSpec } from './types';
import { COLORS, mergeSeriesData } from './chart-utils';

export function AreaChartView({ spec, stacked }: { spec: ChartSpec; stacked: boolean }) {
  const data = mergeSeriesData(spec.series ?? [], spec.xAxis?.key ?? 'x');
  const stackId = stacked ? 'stack' : undefined;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={spec.xAxis?.key ?? 'x'} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} label={spec.yAxis?.label ? { value: spec.yAxis.label, angle: -90, position: 'insideLeft', style: { fontSize: 12 } } : undefined} />
        <Tooltip />
        <Legend />
        {(spec.series ?? []).map((s, i) => (
          <Area key={s.name} type="monotone" dataKey={s.name} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.3} stackId={stackId} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
