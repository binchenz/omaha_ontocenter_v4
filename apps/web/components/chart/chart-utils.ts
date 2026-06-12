import { SeriesItem } from './types';

/** Shared color palette for chart series. */
export const COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea',
  '#0891b2', '#e11d48', '#65a30d', '#7c3aed', '#0d9488',
  '#ea580c', '#4f46e5',
];

/**
 * Merge multiple series into a single flat array keyed by xAxis value.
 * Recharts expects: [{ month: '2025-01', 小米: 1200, 九阳: 800 }, ...]
 */
export function mergeSeriesData(series: SeriesItem[], xKey: string): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const s of series) {
    // Extract value key once per series (first non-xKey property)
    const valKey = s.data.length > 0
      ? Object.keys(s.data[0]).find(k => k !== xKey)
      : null;
    if (!valKey) continue;
    for (const point of s.data) {
      const xVal = String(point[xKey] ?? '');
      if (!map.has(xVal)) map.set(xVal, { [xKey]: xVal });
      map.get(xVal)![s.name] = point[valKey];
    }
  }
  return Array.from(map.values());
}

/**
 * Flatten series for pie chart: [{ name: '小米', value: 45 }, ...]
 */
export function flattenForPie(series: SeriesItem[], valueKey?: string): { name: string; value: number }[] {
  return series.map(s => {
    const total = s.data.reduce((sum, d) => {
      const val = valueKey ? d[valueKey] : Object.values(d).find(v => typeof v === 'number');
      return sum + (typeof val === 'number' ? val : 0);
    }, 0);
    return { name: s.name, value: total };
  });
}
