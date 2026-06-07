'use client';

import { ChartSpec } from './types';

export function KpiCardView({ spec }: { spec: ChartSpec }) {
  const kpis = spec.kpis ?? [];

  return (
    <div className="grid grid-cols-2 gap-3">
      {kpis.map((kpi, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="text-xs text-gray-500 mb-1">{kpi.label}</div>
          <div className="text-2xl font-semibold text-gray-900">{kpi.value}</div>
          {(kpi.change || kpi.trend) && (
            <div className={`text-sm mt-1 ${kpi.trend === 'up' ? 'text-green-600' : kpi.trend === 'down' ? 'text-red-600' : 'text-gray-500'}`}>
              {kpi.trend === 'up' && '↑'}
              {kpi.trend === 'down' && '↓'}
              {kpi.trend === 'flat' && '→'}
              {kpi.change && ` ${kpi.change}`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
