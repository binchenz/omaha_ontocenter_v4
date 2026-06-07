'use client';

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ChartSpec } from './types';
import { COLORS, mergeSeriesData } from './chart-utils';

export function LineChartView({ spec }: { spec: ChartSpec }) {
  const data = mergeSeriesData(spec.series ?? [], spec.xAxis?.key ?? 'x');

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={spec.xAxis?.key ?? 'x'} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} label={spec.yAxis?.label ? { value: spec.yAxis.label, angle: -90, position: 'insideLeft', style: { fontSize: 12 } } : undefined} />
        <Tooltip />
        <Legend />
        {(spec.series ?? []).map((s, i) => (
          <Line key={s.name} type="monotone" dataKey={s.name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
