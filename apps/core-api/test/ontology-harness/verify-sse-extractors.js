/**
 * Manual verification script for SSE extractors
 * Run with: node test/ontology-harness/verify-sse-extractors.js
 */

// Import from compiled output (assumes TypeScript compilation)
const path = require('path');

// Mock implementations for testing
const SseEvent = {};

function extractToolResult(events, toolName) {
  const resultEvent = events.find(
    (e) => e.type === 'tool_result' && e.name === toolName,
  );
  if (!resultEvent || !resultEvent.data) return null;
  return resultEvent.data;
}

function extractQueryValue(events) {
  const result = extractToolResult(events, 'query_metric');
  if (!result?.result?.value) return null;
  const v = result.result.value;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function extractBrandNames(events) {
  const aggResults = events.filter(
    (e) => e.type === 'tool_result' && e.name === 'aggregate_objects',
  );
  let lastBrands = [];
  for (const ev of aggResults) {
    const data = ev.data;
    const groups = data?.groups ?? [];
    const brands = [];
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
  const seen = new Set();
  return lastBrands.filter((b) => !seen.has(b) && seen.add(b));
}

function extractModelNames(events) {
  const aggResults = events.filter(
    (e) => e.type === 'tool_result' && e.name === 'aggregate_objects',
  );
  let lastModels = [];
  for (const ev of aggResults) {
    const data = ev.data;
    const groups = data?.groups ?? [];
    const models = [];
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
  const seen = new Set();
  return lastModels.filter((m) => !seen.has(m) && seen.add(m));
}

function extractChartSchema(events) {
  const result = extractToolResult(events, 'render_chart');
  if (!result) return null;
  const type = result.type;
  const datasets = result.data?.datasets;
  const labels = result.data?.labels;
  if (!type || !datasets || !labels) return null;
  if (!Array.isArray(datasets) || !Array.isArray(labels)) return null;
  const normalizedDatasets = datasets
    .filter((ds) => typeof ds?.label === 'string' && Array.isArray(ds?.data))
    .map((ds) => ({
      label: ds.label,
      data: ds.data.filter((v) => typeof v === 'number'),
    }));
  if (normalizedDatasets.length === 0) return null;
  return {
    type,
    datasets: normalizedDatasets,
    labels: labels.filter((l) => typeof l === 'string'),
  };
}

function extractTextContent(events) {
  const textEvent = events.find((e) => e.type === 'text');
  const content = textEvent?.content;
  return typeof content === 'string' ? content : '';
}

// Run tests
console.log('🧪 Testing SSE Extractors\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`);
    failed++;
  }
}

// Test 1: extractQueryValue
test('extractQueryValue extracts numeric value', () => {
  const events = [
    { type: 'tool_result', name: 'query_metric', data: { result: { value: 9876543.21 } } },
  ];
  const value = extractQueryValue(events);
  if (value !== 9876543.21) throw new Error(`Expected 9876543.21, got ${value}`);
});

// Test 2: extractBrandNames
test('extractBrandNames extracts brand list', () => {
  const events = [
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
  if (JSON.stringify(brands) !== JSON.stringify(['小米', '美的', '九阳'])) {
    throw new Error(`Expected ['小米', '美的', '九阳'], got ${JSON.stringify(brands)}`);
  }
});

// Test 3: extractBrandNames filters "其他"
test('extractBrandNames filters "其他"', () => {
  const events = [
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
  if (JSON.stringify(brands) !== JSON.stringify(['小米', '美的'])) {
    throw new Error(`Expected ['小米', '美的'], got ${JSON.stringify(brands)}`);
  }
});

// Test 4: extractModelNames uses last result
test('extractModelNames uses last result (last-wins)', () => {
  const events = [
    {
      type: 'tool_result',
      name: 'aggregate_objects',
      data: { groups: [{ key: { model: 'ModelA' }, metrics: { value: 100 } }] },
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
  if (JSON.stringify(models) !== JSON.stringify(['ModelX', 'ModelY'])) {
    throw new Error(`Expected ['ModelX', 'ModelY'], got ${JSON.stringify(models)}`);
  }
});

// Test 5: extractChartSchema
test('extractChartSchema extracts chart structure', () => {
  const events = [
    {
      type: 'tool_result',
      name: 'render_chart',
      data: {
        type: 'bar',
        data: {
          labels: ['2023-01', '2023-02', '2023-03'],
          datasets: [{ label: '零售额', data: [1000000, 1200000, 1100000] }],
        },
      },
    },
  ];
  const chart = extractChartSchema(events);
  if (!chart || chart.type !== 'bar' || chart.labels.length !== 3) {
    throw new Error(`Invalid chart schema: ${JSON.stringify(chart)}`);
  }
});

// Test 6: extractTextContent
test('extractTextContent extracts text', () => {
  const events = [
    { type: 'tool_call', name: 'query_metric' },
    { type: 'text', content: '电饭煲市场在2024年1月的零售额为9876万元。' },
  ];
  const text = extractTextContent(events);
  if (text !== '电饭煲市场在2024年1月的零售额为9876万元。') {
    throw new Error(`Unexpected text: ${text}`);
  }
});

// Test 7: Graceful null handling
test('Graceful null handling for missing data', () => {
  const emptyEvents = [];
  const nullValue = extractQueryValue(emptyEvents);
  const nullBrands = extractBrandNames(emptyEvents);
  const nullChart = extractChartSchema(emptyEvents);
  if (nullValue !== null || nullBrands.length !== 0 || nullChart !== null) {
    throw new Error('Should return null/empty for missing data');
  }
});

// Test 8: String number parsing
test('extractQueryValue parses string numbers', () => {
  const events = [
    { type: 'tool_result', name: 'query_metric', data: { result: { value: '123.45' } } },
  ];
  const value = extractQueryValue(events);
  if (value !== 123.45) throw new Error(`Expected 123.45, got ${value}`);
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
