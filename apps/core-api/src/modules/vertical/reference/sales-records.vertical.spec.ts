import { SALES_RECORDS_VERTICAL } from './sales-records.vertical';

// The reference vertical wires its star schema into the platform seams. These tests pin the
// contribution contract — what a community OPC sees when they copy this package (ADR-0062 §4).
describe('Sales Records reference vertical — manifest (ADR-0062 §4)', () => {
  it('declares a stable name', () => {
    expect(SALES_RECORDS_VERTICAL.name).toBe('sales-records');
  });

  it('contributes a sales-analysis skill that teaches the additivity + universe discipline', () => {
    const skills = SALES_RECORDS_VERTICAL.skills ?? [];
    expect(skills).toHaveLength(1);
    const prompt = skills[0].systemPrompt({ tenantId: 't1' });
    // the prose must carry the two disciplines the reference vertical exists to demo
    expect(prompt).toMatch(/avg_price|均价/);     // ratio metric not summable
    expect(prompt).toMatch(/样本|top-sample|sales_line/); // detail layer is a sample, not whole-market
  });
});
