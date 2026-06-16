/**
 * Sales Records — the neutral reference vertical's star schema (ADR-0062 §4, #207).
 *
 * The community template: structurally isomorphic to AVC but client-free. Every ADR-0061 semantic
 * is demoed exactly once so a community OPC can copy this package, rename `sales_*` to its own
 * domain, and have a working vertical. Two stars:
 *   - `sales_record` — long-format summary (region/product/period/metric/value). Demos additivity
 *     (units_sold/revenue additive, avg_price ratio — enforced via skill groupBy guidance the same
 *     way AVC's long-format market_metric is), `collapsedDefault` (region), universe=whole-market.
 *   - `sales_line`   — per-SKU detail sample. Demos universe=top-sample + is the drill target.
 */
export const SALES_RECORD_TYPE = 'sales_record';
export const SALES_LINE_TYPE = 'sales_line';

export const SALES_RECORD_DEF = {
  name: SALES_RECORD_TYPE,
  label: '销售记录',
  description: '通用销售汇总：按大区/产品线/月份的销量、销售额与均价（长表，指标分行）',
  properties: [
    { name: 'region', label: '大区', type: 'string' as const, filterable: true },
    { name: 'product', label: '产品线', type: 'string' as const, filterable: true },
    { name: 'period', label: '月份', type: 'string' as const, filterable: true, sortable: true },
    { name: 'metric', label: '指标', type: 'string' as const, filterable: true, allowedValues: ['units_sold', 'revenue', 'avg_price'] },
    // ADR-0061 §1: long-format measure — additivity belongs to the metric ROW, not the column.
    // units_sold/revenue rows are additive; avg_price is a ratio. With a single `value` column the
    // guard cannot tag per-row, so metric-aware additivity is enforced via the skill's groupBy
    // guidance (mirrors AVC market_metric); `value` stays untagged (additive) — correct for the
    // units/revenue rows it usually holds.
    { name: 'value', label: '数值', type: 'number' as const, sortable: true },
  ],
  derivedProperties: [],
  // ADR-0061 §3: region is BOTH defaulted (auto-pinned to 全国) AND collapsedDefault (surfaced
  // through the schema so the Agent knows the dimension exists and must be drilled, not
  // reverse-asserted as absent — the dimension-default-blindspot demo).
  dimensions: { required: ['product', 'period'], defaults: { region: '全国' }, collapsedDefault: { region: '全国' } },
  semantics: { universe: 'whole-market' as const }, // ADR-0061 §2: 全量市场口径
};

export const SALES_LINE_DEF = {
  name: SALES_LINE_TYPE,
  label: '销售明细',
  description: '通用销售明细样本：单 SKU 的月度单价与销量，按大区/产品线/SKU/月份',
  properties: [
    { name: 'region', label: '大区', type: 'string' as const, filterable: true },
    { name: 'product', label: '产品线', type: 'string' as const, filterable: true },
    { name: 'sku', label: 'SKU', type: 'string' as const, filterable: true },
    { name: 'period', label: '月份', type: 'string' as const, filterable: true, sortable: true },
    // ADR-0061 §1: unitPrice is a ratio (value/volume); unitsSold is additive across a group.
    { name: 'unitPrice', label: '单价', type: 'number' as const, sortable: true, additivity: 'ratio' as const },
    { name: 'unitsSold', label: '销量', type: 'number' as const, sortable: true, additivity: 'additive' as const },
  ],
  derivedProperties: [],
  dimensions: { required: ['product', 'period'], defaults: {} },
  semantics: { universe: 'top-sample' as const }, // ADR-0061 §2: TOP 样本，非全量
};
