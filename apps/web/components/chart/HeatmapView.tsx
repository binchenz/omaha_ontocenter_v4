'use client';

import { ChartSpec } from './types';
import { COLORS } from './chart-utils';

export function HeatmapView({ spec }: { spec: ChartSpec }) {
  const matrix = spec.matrix;
  if (!matrix) return <div className="text-sm text-gray-500">缺少 matrix 数据</div>;

  const { xLabels, yLabels, values } = matrix;
  const allValues = values.flat();
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  function getColor(val: number): string {
    const ratio = (val - min) / range;
    // Blue (cold) → Red (hot)
    const r = Math.round(59 + ratio * (220 - 59));
    const g = Math.round(130 + ratio * (38 - 130));
    const b = Math.round(246 + ratio * (38 - 246));
    return `rgb(${r}, ${g}, ${b})`;
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="p-2" />
            {xLabels.map(x => (
              <th key={x} className="p-2 text-center font-medium text-gray-600">{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {yLabels.map((y, ri) => (
            <tr key={y}>
              <td className="p-2 font-medium text-gray-600 whitespace-nowrap">{y}</td>
              {xLabels.map((_, ci) => {
                const val = values[ri]?.[ci] ?? 0;
                return (
                  <td key={ci} className="p-2 text-center text-white font-medium rounded" style={{ backgroundColor: getColor(val), minWidth: 48 }}>
                    {val}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
