'use client';

import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ChartSpec } from './types';
import { COLORS } from './chart-utils';

export function ScatterChartView({ spec }: { spec: ChartSpec }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={spec.xAxis?.key ?? 'x'} name={spec.xAxis?.label} tick={{ fontSize: 12 }} />
        <YAxis dataKey={spec.yAxis?.key ?? 'y'} name={spec.yAxis?.label} tick={{ fontSize: 12 }} />
        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
        <Legend />
        {(spec.series ?? []).map((s, i) => (
          <Scatter key={s.name} name={s.name} data={s.data} fill={COLORS[i % COLORS.length]} />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
