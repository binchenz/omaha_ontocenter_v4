/**
 * SSE Event Extractors for Ontology Ground Truth Harness
 *
 * Generic and specific extractors for parsing Agent SSE events and extracting
 * tool results. Follows patterns from delivery-report/scenario-judges.ts and
 * test-helpers.ts.
 *
 * Design principles:
 * - Graceful degradation: return null for missing/malformed events, never throw
 * - Type-safe: use TypeScript generics for flexible tool result extraction
 * - Last-wins: when multiple results exist, prefer the last (most refined query)
 */

export interface SseEvent {
  type: string;
  name?: string;
  id?: string;
  data?: unknown;
  [key: string]: unknown;
}

/**
 * Generic tool result extractor. Finds the first tool_result event matching
 * the given tool name and parses its data field.
 *
 * @param events - Array of SSE events from Agent response
 * @param toolName - Name of the tool to extract results from
 * @returns Parsed tool result data or null if not found/malformed
 *
 * @example
 * const result = extractToolResult<{value: number}>(events, 'query_metric');
 * if (result) console.log(result.value);
 */
export function extractToolResult<T>(events: SseEvent[], toolName: string): T | null {
  const resultEvent = events.find(
    (e) => e.type === 'tool_result' && e.name === toolName,
  );

  if (!resultEvent || !resultEvent.data) return null;

  try {
    // data is already parsed JSON in our SSE pipeline
    return resultEvent.data as T;
  } catch {
    return null;
  }
}

/**
 * Extract a numeric value from query_metric tool result.
 *
 * Follows ADR-0064 semantic layer: query_metric returns { result: { value: number } }.
 *
 * @param events - Array of SSE events from Agent response
 * @returns The metric value or null if not found
 *
 * @example
 * const value = extractQueryValue(events);
 * // Returns: 123456789.5 or null
 */
export function extractQueryValue(events: SseEvent[]): number | null {
  const result = extractToolResult<{ result?: { value?: unknown } }>(events, 'query_metric');

  if (!result?.result?.value) return null;

  const v = result.result.value;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }

  return null;
}

/**
 * Extract brand names from aggregate_objects tool result.
 *
 * Uses the LAST aggregate_objects result with brand grouping (most refined query).
 * Filters out '其他' (Other) as it's typically not a real brand.
 *
 * @param events - Array of SSE events from Agent response
 * @returns Array of brand names, deduplicated in order
 *
 * @example
 * const brands = extractBrandNames(events);
 * // Returns: ['小米', '美的', '九阳'] or []
 */
export function extractBrandNames(events: SseEvent[]): string[] {
  const aggResults = events.filter(
    (e) => e.type === 'tool_result' && e.name === 'aggregate_objects',
  );

  let lastBrands: string[] = [];

  // Take the LAST result with brand grouping (most refined query)
  for (const ev of aggResults) {
    const data = ev.data as { groups?: Array<{ key?: { brand?: unknown } }> } | undefined;
    const groups = data?.groups ?? [];
    const brands: string[] = [];

    for (const g of groups) {
      const brand = g.key?.brand;
      if (typeof brand === 'string' && brand.trim() && brand.trim() !== '其他') {
        brands.push(brand.trim());
      }
    }

    if (brands.length > 0) {
      lastBrands = brands;
    }
  }

  // Dedup preserving order
  const seen = new Set<string>();
  return lastBrands.filter((b) => !seen.has(b) && seen.add(b));
}

/**
 * Extract model names from aggregate_objects tool result.
 *
 * Uses the LAST aggregate_objects result with model grouping (same reasoning
 * as extractBrandNames: Agent typically refines its query over multiple tool calls).
 *
 * @param events - Array of SSE events from Agent response
 * @returns Array of model names, deduplicated in order
 *
 * @example
 * const models = extractModelNames(events);
 * // Returns: ['MI-RCA-5L', 'MD-X500', 'JY-F40FZ'] or []
 */
export function extractModelNames(events: SseEvent[]): string[] {
  const aggResults = events.filter(
    (e) => e.type === 'tool_result' && e.name === 'aggregate_objects',
  );

  let lastModels: string[] = [];

  // Take the LAST result with model grouping
  for (const ev of aggResults) {
    const data = ev.data as { groups?: Array<{ key?: { model?: unknown } }> } | undefined;
    const groups = data?.groups ?? [];
    const models: string[] = [];

    for (const g of groups) {
      const model = g.key?.model;
      if (typeof model === 'string' && model.trim()) {
        models.push(model.trim());
      }
    }

    if (models.length > 0) {
      lastModels = models;
    }
  }

  // Dedup preserving order
  const seen = new Set<string>();
  return lastModels.filter((m) => !seen.has(m) && seen.add(m));
}

/**
 * Chart schema extracted from render_chart tool result.
 */
export interface ChartSchema {
  type: string;
  datasets: Array<{
    label: string;
    data: number[];
  }>;
  labels: string[];
}

/**
 * Extract chart schema from render_chart tool result.
 *
 * The render_chart tool returns a chart configuration with type, datasets, and labels.
 * This extractor normalizes the structure for test verification.
 *
 * @param events - Array of SSE events from Agent response
 * @returns Chart schema or null if not found/malformed
 *
 * @example
 * const chart = extractChartSchema(events);
 * if (chart) {
 *   expect(chart.type).toBe('bar');
 *   expect(chart.labels).toEqual(['2023-01', '2023-02', '2023-03']);
 * }
 */
export function extractChartSchema(events: SseEvent[]): ChartSchema | null {
  const result = extractToolResult<{
    type?: string;
    data?: {
      datasets?: Array<{ label?: string; data?: number[] }>;
      labels?: string[];
    };
  }>(events, 'render_chart');

  if (!result) return null;

  // Handle both direct structure and nested data structure
  const type = result.type;
  const datasets = result.data?.datasets;
  const labels = result.data?.labels;

  if (!type || !datasets || !labels) return null;

  // Validate structure
  if (!Array.isArray(datasets) || !Array.isArray(labels)) return null;

  // Normalize dataset structure
  const normalizedDatasets = datasets
    .filter((ds): ds is { label: string; data: number[] } =>
      typeof ds?.label === 'string' && Array.isArray(ds?.data)
    )
    .map((ds) => ({
      label: ds.label,
      data: ds.data.filter((v): v is number => typeof v === 'number'),
    }));

  if (normalizedDatasets.length === 0) return null;

  return {
    type,
    datasets: normalizedDatasets,
    labels: labels.filter((l): l is string => typeof l === 'string'),
  };
}

/**
 * Extract text content from SSE events.
 *
 * Finds the first 'text' event and returns its content field.
 * Used for behavior verification (honesty checks, trend keywords, etc.).
 *
 * @param events - Array of SSE events from Agent response
 * @returns Text content or empty string if not found
 *
 * @example
 * const text = extractTextContent(events);
 * expect(text).toContain('电饭煲市场规模');
 */
export function extractTextContent(events: SseEvent[]): string {
  const textEvent = events.find((e) => e.type === 'text');
  const content = (textEvent as { content?: unknown })?.content;
  return typeof content === 'string' ? content : '';
}
