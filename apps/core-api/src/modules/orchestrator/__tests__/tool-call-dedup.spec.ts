import { ToolCallDedup } from '../tool-call-dedup';

describe('ToolCallDedup — equivalence key (#194)', () => {
  it('treats same name + same query shape as equivalent regardless of key order', () => {
    const a = ToolCallDedup.key('aggregate_objects', { objectType: 'brand_share', filters: [{ field: 'category', value: '电饭煲' }], groupBy: ['brand'] });
    const b = ToolCallDedup.key('aggregate_objects', { groupBy: ['brand'], objectType: 'brand_share', filters: [{ field: 'category', value: '电饭煲' }] });
    expect(a).toBe(b);
  });

  it('ignores pagination fields (a re-fetch of an earlier page is a repeat)', () => {
    const a = ToolCallDedup.key('query_objects', { objectType: 'brand_share', page: 1, pageSize: 50 });
    const b = ToolCallDedup.key('query_objects', { objectType: 'brand_share', page: 3, pageSize: 50 });
    expect(a).toBe(b);
  });

  it('distinguishes different filter values', () => {
    const a = ToolCallDedup.key('query_objects', { objectType: 'brand_share', filters: [{ field: 'period', value: '26.04' }] });
    const b = ToolCallDedup.key('query_objects', { objectType: 'brand_share', filters: [{ field: 'period', value: '25.12' }] });
    expect(a).not.toBe(b);
  });

  it('distinguishes different object types', () => {
    expect(ToolCallDedup.key('query_objects', { objectType: 'brand_share' }))
      .not.toBe(ToolCallDedup.key('query_objects', { objectType: 'model_metric' }));
  });

  it('caches and returns a hit for an equivalent call', () => {
    const d = new ToolCallDedup();
    expect(d.get('query_objects', { objectType: 'brand_share', filters: [{ field: 'category', value: '电饭煲' }] }).hit).toBe(false);
    d.set('query_objects', { objectType: 'brand_share', filters: [{ field: 'category', value: '电饭煲' }] }, { rows: 3 });
    const hit = d.get('query_objects', { filters: [{ field: 'category', value: '电饭煲' }], objectType: 'brand_share' });
    expect(hit.hit).toBe(true);
    expect(hit.value).toEqual({ rows: 3 });
  });

  it('falls back to full args for tools with no recognized query shape (no false collisions)', () => {
    expect(ToolCallDedup.key('render_chart', { type: 'bar', title: 'A' }))
      .not.toBe(ToolCallDedup.key('render_chart', { type: 'line', title: 'B' }));
  });
});
