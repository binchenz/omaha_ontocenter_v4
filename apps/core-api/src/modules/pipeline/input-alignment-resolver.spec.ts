import { resolveInputAlignment } from './input-alignment-resolver';

/**
 * InputAlignmentResolver black-box spec (ADR-0060 #5, model 1′). This pure function is the core
 * defense against fact×fact cross-batch mis-pairing (the invisible-wrong-answer trap), so the
 * decision matrix is tested item-by-item and densely.
 *
 * Vocabulary:
 *  - declaredInputs: the input source names a Pipeline declares (e.g. ['orders','refunds']).
 *  - readyVersionsByInput: per input, the ready Dataset versions available, each {datasetId, alignKeyValue?}.
 *  - alignKey: optional; when set, a run fires only when every input shares one alignKeyValue.
 * Result: { fire, chosenVersions: { [inputName]: datasetId } }.
 */
describe('resolveInputAlignment (model 1′)', () => {
  it('single input, one ready version → fires with that version (no regression)', () => {
    const res = resolveInputAlignment(
      ['orders'],
      { orders: [{ datasetId: 'ds-o-1' }] },
    );
    expect(res.fire).toBe(true);
    expect(res.chosenVersions).toEqual({ orders: 'ds-o-1' });
  });

  describe('all-ready gate', () => {
    it('does NOT fire when a declared input has no ready version', () => {
      const res = resolveInputAlignment(
        ['orders', 'refunds'],
        { orders: [{ datasetId: 'ds-o-1' }] }, // refunds missing
      );
      expect(res.fire).toBe(false);
    });

    it('does NOT fire when a declared input is present but empty', () => {
      const res = resolveInputAlignment(
        ['orders', 'refunds'],
        { orders: [{ datasetId: 'ds-o-1' }], refunds: [] },
      );
      expect(res.fire).toBe(false);
    });
  });

  describe('no alignKey → latest ready of each input', () => {
    it('fires with the latest ready version of every input once all are ready', () => {
      const res = resolveInputAlignment(
        ['orders', 'refunds'],
        {
          orders: [{ datasetId: 'ds-o-1' }, { datasetId: 'ds-o-2' }], // newest last
          refunds: [{ datasetId: 'ds-r-1' }],
        },
      );
      expect(res.fire).toBe(true);
      expect(res.chosenVersions).toEqual({ orders: 'ds-o-2', refunds: 'ds-r-1' });
    });
  });

  describe('alignKey → same-key join only (cross-batch mis-pairing defense)', () => {
    it('fires joining only the same-key versions when a shared key exists', () => {
      const res = resolveInputAlignment(
        ['orders', 'refunds'],
        {
          orders: [
            { datasetId: 'ds-o-may', alignKeyValue: '2026-05' },
            { datasetId: 'ds-o-jun', alignKeyValue: '2026-06' },
          ],
          refunds: [
            { datasetId: 'ds-r-jun', alignKeyValue: '2026-06' },
          ],
        },
        'reportMonth',
      );
      expect(res.fire).toBe(true);
      // June orders pair with June refunds — never May.
      expect(res.chosenVersions).toEqual({ orders: 'ds-o-jun', refunds: 'ds-r-jun' });
    });

    it('does NOT fire when only different keys are present (6月订单 vs 5月退款)', () => {
      const res = resolveInputAlignment(
        ['orders', 'refunds'],
        {
          orders: [{ datasetId: 'ds-o-jun', alignKeyValue: '2026-06' }],
          refunds: [{ datasetId: 'ds-r-may', alignKeyValue: '2026-05' }],
        },
        'reportMonth',
      );
      expect(res.fire).toBe(false);
    });

    it('picks the newest shared key when several keys align across all inputs', () => {
      const res = resolveInputAlignment(
        ['orders', 'refunds'],
        {
          orders: [
            { datasetId: 'ds-o-may', alignKeyValue: '2026-05' },
            { datasetId: 'ds-o-jun', alignKeyValue: '2026-06' },
          ],
          refunds: [
            { datasetId: 'ds-r-may', alignKeyValue: '2026-05' },
            { datasetId: 'ds-r-jun', alignKeyValue: '2026-06' },
          ],
        },
        'reportMonth',
      );
      expect(res.fire).toBe(true);
      expect(res.chosenVersions).toEqual({ orders: 'ds-o-jun', refunds: 'ds-r-jun' });
    });

    it('does NOT fire when an input lacks an alignKeyValue on its ready versions', () => {
      // alignKey declared but a source could not supply the batch key → cannot safely pair.
      const res = resolveInputAlignment(
        ['orders', 'refunds'],
        {
          orders: [{ datasetId: 'ds-o-jun', alignKeyValue: '2026-06' }],
          refunds: [{ datasetId: 'ds-r-x' }], // no alignKeyValue
        },
        'reportMonth',
      );
      expect(res.fire).toBe(false);
    });
  });
});
