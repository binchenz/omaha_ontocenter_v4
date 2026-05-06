import { formatToolResultForLlm } from '../format-tool-result';

describe('formatToolResultForLlm', () => {
  it('wraps payload in <data> tags with JSON-stringified content', () => {
    const result = formatToolResultForLlm({ data: [1, 2], meta: { total: 2 } });
    expect(result).toBe('<data>{"data":[1,2],"meta":{"total":2}}</data>');
  });

  it('wraps null and primitives', () => {
    expect(formatToolResultForLlm(null)).toBe('<data>null</data>');
    expect(formatToolResultForLlm({ rejected: true })).toBe('<data>{"rejected":true}</data>');
  });

  it('always starts with <data> and ends with </data>', () => {
    const out = formatToolResultForLlm({ error: 'something failed' });
    expect(out.startsWith('<data>')).toBe(true);
    expect(out.endsWith('</data>')).toBe(true);
  });
});
