/**
 * Unit tests for SSE extractors
 *
 * Tests cover:
 * - Generic extractToolResult with different data types
 * - Specific extractors (query value, brands, models, chart)
 * - Graceful degradation (null returns, no throws)
 * - Last-wins behavior for multi-result queries
 */

import {
  extractToolResult,
  extractQueryValue,
  extractBrandNames,
  extractModelNames,
  extractChartSchema,
  extractTextContent,
  type SseEvent,
} from './sse-extractors';

describe('SSE Extractors', () => {
  describe('extractToolResult', () => {
    it('extracts typed tool result data', () => {
      const events: SseEvent[] = [
        { type: 'tool_call', name: 'query_metric', id: 'call_1' },
        {
          type: 'tool_result',
          name: 'query_metric',
          id: 'call_1',
          data: { result: { value: 123456.78 } },
        },
      ];

      const result = extractToolResult<{ result: { value: number } }>(events, 'query_metric');
      expect(result).toEqual({ result: { value: 123456.78 } });
    });

    it('returns null when tool not found', () => {
      const events: SseEvent[] = [
        { type: 'tool_call', name: 'other_tool', id: 'call_1' },
      ];

      const result = extractToolResult(events, 'query_metric');
      expect(result).toBeNull();
    });

    it('returns null when data field missing', () => {
      const events: SseEvent[] = [
        { type: 'tool_result', name: 'query_metric', id: 'call_1' },
      ];

      const result = extractToolResult(events, 'query_metric');
      expect(result).toBeNull();
    });

    it('handles multiple tool results, returns first match', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'query_metric',
          id: 'call_1',
          data: { result: { value: 100 } },
        },
        {
          type: 'tool_result',
          name: 'query_metric',
          id: 'call_2',
          data: { result: { value: 200 } },
        },
      ];

      const result = extractToolResult<{ result: { value: number } }>(events, 'query_metric');
      expect(result).toEqual({ result: { value: 100 } });
    });
  });

  describe('extractQueryValue', () => {
    it('extracts numeric value from query_metric result', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'query_metric',
          data: { result: { value: 9876543.21 } },
        },
      ];

      const value = extractQueryValue(events);
      expect(value).toBe(9876543.21);
    });

    it('parses string numbers', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'query_metric',
          data: { result: { value: '123.45' } },
        },
      ];

      const value = extractQueryValue(events);
      expect(value).toBe(123.45);
    });

    it('returns null when value missing', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'query_metric',
          data: { result: {} },
        },
      ];

      const value = extractQueryValue(events);
      expect(value).toBeNull();
    });

    it('returns null when query_metric not found', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'aggregate_objects',
          data: { groups: [] },
        },
      ];

      const value = extractQueryValue(events);
      expect(value).toBeNull();
    });

    it('returns null for non-numeric values', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'query_metric',
          data: { result: { value: 'not a number' } },
        },
      ];

      const value = extractQueryValue(events);
      expect(value).toBeNull();
    });
  });

  describe('extractBrandNames', () => {
    it('extracts brand names from aggregate_objects groups', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'aggregate_objects',
          data: {
            groups: [
              { key: { brand: '小米' }, metrics: { value: 0.25 } },
              { key: { brand: '美的' }, metrics: { value: 0.20 } },
              { key: { brand: '九阳' }, metrics: { value: 0.15 } },
            ],
          },
        },
      ];

      const brands = extractBrandNames(events);
      expect(brands).toEqual(['小米', '美的', '九阳']);
    });

    it('filters out "其他" brand', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'aggregate_objects',
          data: {
            groups: [
              { key: { brand: '小米' }, metrics: { value: 0.25 } },
              { key: { brand: '其他' }, metrics: { value: 0.05 } },
              { key: { brand: '美的' }, metrics: { value: 0.20 } },
            ],
          },
        },
      ];

      const brands = extractBrandNames(events);
      expect(brands).toEqual(['小米', '美的']);
    });

    it('uses last result when multiple aggregate calls exist', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'aggregate_objects',
          data: {
            groups: [
              { key: { brand: '小米' }, metrics: { value: 0.25 } },
              { key: { brand: '美的' }, metrics: { value: 0.20 } },
            ],
          },
        },
        {
          type: 'tool_result',
          name: 'aggregate_objects',
          data: {
            groups: [
              { key: { brand: '华为' }, metrics: { value: 0.30 } },
              { key: { brand: 'OPPO' }, metrics: { value: 0.25 } },
              { key: { brand: 'vivo' }, metrics: { value: 0.20 } },
            ],
          },
        },
      ];

      const brands = extractBrandNames(events);
      expect(brands).toEqual(['华为', 'OPPO', 'vivo']);
    });

    it('deduplicates brands preserving order', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'aggregate_objects',
          data: {
            groups: [
              { key: { brand: '小米' }, metrics: { value: 0.25 } },
              { key: { brand: '美的' }, metrics: { value: 0.20 } },
              { key: { brand: '小米' }, metrics: { value: 0.15 } }, // duplicate
            ],
          },
        },
      ];

      const brands = extractBrandNames(events);
      expect(brands).toEqual(['小米', '美的']);
    });

    it('returns empty array when no brand data', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'aggregate_objects',
          data: { groups: [] },
        },
      ];

      const brands = extractBrandNames(events);
      expect(brands).toEqual([]);
    });

    it('returns empty array when aggregate_objects not found', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'query_metric',
          data: { result: { value: 100 } },
        },
      ];

      const brands = extractBrandNames(events);
      expect(brands).toEqual([]);
    });

    it('trims whitespace from brand names', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'aggregate_objects',
          data: {
            groups: [
              { key: { brand: '  小米  ' }, metrics: { value: 0.25 } },
              { key: { brand: 'HUAWEI ' }, metrics: { value: 0.20 } },
            ],
          },
        },
      ];

      const brands = extractBrandNames(events);
      expect(brands).toEqual(['小米', 'HUAWEI']);
    });
  });

  describe('extractModelNames', () => {
    it('extracts model names from aggregate_objects groups', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'aggregate_objects',
          data: {
            groups: [
              { key: { model: 'MI-RCA-5L' }, metrics: { valueShare: 0.05 } },
              { key: { model: 'MD-X500' }, metrics: { valueShare: 0.04 } },
              { key: { model: 'JY-F40FZ' }, metrics: { valueShare: 0.03 } },
            ],
          },
        },
      ];

      const models = extractModelNames(events);
      expect(models).toEqual(['MI-RCA-5L', 'MD-X500', 'JY-F40FZ']);
    });

    it('uses last result when multiple aggregate calls exist', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'aggregate_objects',
          data: {
            groups: [
              { key: { model: 'ModelA' }, metrics: { value: 100 } },
              { key: { model: 'ModelB' }, metrics: { value: 90 } },
            ],
          },
        },
        {
          type: 'tool_result',
          name: 'aggregate_objects',
          data: {
            groups: [
              { key: { model: 'ModelX' }, metrics: { value: 200 } },
              { key: { model: 'ModelY' }, metrics: { value: 180 } },
            ],
          },
        },
      ];

      const models = extractModelNames(events);
      expect(models).toEqual(['ModelX', 'ModelY']);
    });

    it('deduplicates models preserving order', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'aggregate_objects',
          data: {
            groups: [
              { key: { model: 'MI-RCA-5L' }, metrics: { value: 0.05 } },
              { key: { model: 'MD-X500' }, metrics: { value: 0.04 } },
              { key: { model: 'MI-RCA-5L' }, metrics: { value: 0.03 } }, // duplicate
            ],
          },
        },
      ];

      const models = extractModelNames(events);
      expect(models).toEqual(['MI-RCA-5L', 'MD-X500']);
    });

    it('returns empty array when no model data', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'aggregate_objects',
          data: { groups: [] },
        },
      ];

      const models = extractModelNames(events);
      expect(models).toEqual([]);
    });
  });

  describe('extractChartSchema', () => {
    it('extracts chart type, datasets, and labels', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'render_chart',
          data: {
            type: 'bar',
            data: {
              labels: ['2023-01', '2023-02', '2023-03'],
              datasets: [
                {
                  label: '零售额',
                  data: [1000000, 1200000, 1100000],
                },
              ],
            },
          },
        },
      ];

      const chart = extractChartSchema(events);
      expect(chart).toEqual({
        type: 'bar',
        labels: ['2023-01', '2023-02', '2023-03'],
        datasets: [
          {
            label: '零售额',
            data: [1000000, 1200000, 1100000],
          },
        ],
      });
    });

    it('handles multiple datasets', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'render_chart',
          data: {
            type: 'line',
            data: {
              labels: ['Q1', 'Q2', 'Q3', 'Q4'],
              datasets: [
                { label: '小米', data: [25, 27, 26, 28] },
                { label: '美的', data: [20, 21, 22, 23] },
              ],
            },
          },
        },
      ];

      const chart = extractChartSchema(events);
      expect(chart?.datasets).toHaveLength(2);
      expect(chart?.datasets[0].label).toBe('小米');
      expect(chart?.datasets[1].label).toBe('美的');
    });

    it('returns null when render_chart not found', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'query_metric',
          data: { result: { value: 100 } },
        },
      ];

      const chart = extractChartSchema(events);
      expect(chart).toBeNull();
    });

    it('returns null when chart structure malformed', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'render_chart',
          data: {
            type: 'bar',
            // missing data.datasets and data.labels
          },
        },
      ];

      const chart = extractChartSchema(events);
      expect(chart).toBeNull();
    });

    it('filters out invalid datasets', () => {
      const events: SseEvent[] = [
        {
          type: 'tool_result',
          name: 'render_chart',
          data: {
            type: 'bar',
            data: {
              labels: ['A', 'B'],
              datasets: [
                { label: 'Valid', data: [1, 2] },
                { label: 'Missing data' }, // no data field
                { data: [3, 4] }, // no label field
              ],
            },
          },
        },
      ];

      const chart = extractChartSchema(events);
      expect(chart?.datasets).toHaveLength(1);
      expect(chart?.datasets[0].label).toBe('Valid');
    });
  });

  describe('extractTextContent', () => {
    it('extracts text content from text event', () => {
      const events: SseEvent[] = [
        { type: 'tool_call', name: 'query_metric' },
        { type: 'tool_result', name: 'query_metric', data: {} },
        { type: 'text', content: '电饭煲市场在2024年1月的零售额为9876万元。' },
      ];

      const text = extractTextContent(events);
      expect(text).toBe('电饭煲市场在2024年1月的零售额为9876万元。');
    });

    it('returns empty string when text event not found', () => {
      const events: SseEvent[] = [
        { type: 'tool_call', name: 'query_metric' },
        { type: 'tool_result', name: 'query_metric', data: {} },
      ];

      const text = extractTextContent(events);
      expect(text).toBe('');
    });

    it('returns empty string when content field missing', () => {
      const events: SseEvent[] = [
        { type: 'text' }, // no content field
      ];

      const text = extractTextContent(events);
      expect(text).toBe('');
    });

    it('returns first text event when multiple exist', () => {
      const events: SseEvent[] = [
        { type: 'text', content: 'First response' },
        { type: 'text', content: 'Second response' },
      ];

      const text = extractTextContent(events);
      expect(text).toBe('First response');
    });
  });
});
