'use client';

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine } from 'recharts';
import { ChartSpec } from './types';

export function WaterfallChartView({ spec }: { spec: ChartSpec }) {
  // Waterfall: series[0].data should be [{name: '品牌A', value: 5}, {name: '品牌B', value: -3}]
  const rawData = spec.series?.[0]?.data ?? [];
  const xKey = spec.xAxis?.key ?? 'name';
  const yKey = spec.yAxis?.key ?? 'value';

  // Build waterfall data with invisible base + visible bar
  let running = 0;
  const data = rawData.map(d => {
    const name = String(d[xKey] ?? '');
    const val = Number(d[yKey] ?? 0);
    const base = running;
    running += val;
    return { name, value: val, base, top: running };
  });

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip formatter={(value: number) => `${value > 0 ? '+' : ''}${value}`} />
        <ReferenceLine y={0} stroke="#666" />
        {/* Invisible base */}
        <Bar dataKey="base" stackId="waterfall" fill="transparent" />
        {/* Visible bar */}
        <Bar dataKey="value" stackId="waterfall">
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.value >= 0 ? '#16a34a' : '#dc2626'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
