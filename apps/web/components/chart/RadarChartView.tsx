'use client';

import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, Tooltip } from 'recharts';
import { ChartSpec } from './types';
import { COLORS } from './chart-utils';

export function RadarChartView({ spec }: { spec: ChartSpec }) {
  // Merge series data by axis name
  const axes = spec.axes ?? [];
  const data = axes.map(a => {
    const row: Record<string, unknown> = { axis: a.axis };
    for (const s of spec.series ?? []) {
      const point = s.data.find(d => d.axis === a.axis || d[spec.xAxis?.key ?? 'axis'] === a.axis);
      if (point) {
        const valKey = Object.keys(point).find(k => k !== 'axis' && k !== spec.xAxis?.key);
        if (valKey) row[s.name] = point[valKey];
      }
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={data}>
        <PolarGrid />
        <PolarAngleAxis dataKey="axis" tick={{ fontSize: 12 }} />
        <PolarRadiusAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        <Legend />
        {(spec.series ?? []).map((s, i) => (
          <Radar key={s.name} name={s.name} dataKey={s.name} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.3} />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );
}
