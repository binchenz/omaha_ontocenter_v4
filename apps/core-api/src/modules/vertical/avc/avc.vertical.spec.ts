import { AVC_VERTICAL } from './avc.vertical';

// ADR-0062 §3/§4 — the AVC drill-gate, previously hardcoded in agent.module as a TODO(#208), now
// lives in the AVC vertical manifest. This is the SECOND drill-gate implementation in the repo
// (the reference vertical is the first public one), proving the seam is real, not AVC-shaped.
describe('AVC vertical — manifest (ADR-0062 §3)', () => {
  it('declares a stable name', () => {
    expect(AVC_VERTICAL.name).toBe('avc');
  });

  it('contributes the brand/market → model_metric drill-gate', () => {
    const gates = AVC_VERTICAL.drillGates ?? [];
    expect(gates).toHaveLength(1);
    expect(gates[0].drillTarget).toBe('model_metric');
    expect([...gates[0].broadLayer].sort()).toEqual(['brand_share', 'market_metric']);
    expect(gates[0].confirmMessage).toContain('机型');
  });
});
