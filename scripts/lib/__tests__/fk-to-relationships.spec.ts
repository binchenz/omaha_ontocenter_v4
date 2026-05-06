import { describe, it, expect } from 'vitest';
import { applyFkRelationships, type FkSpec } from '../fk-to-relationships';

describe('applyFkRelationships', () => {
  describe('single non-nullable FK (Character.novel_id → Novel)', () => {
    const fkSpec: FkSpec = [
      { sourceTable: 'novel_characters', sourceColumn: 'novel_id', relationshipName: 'belongsTo', targetTable: 'novels' },
    ];
    const novelInstanceIdByExternalId = { 'novel-1': 'platform-novel-1' };

    it('writes relationship name → platform instance id when the FK resolves', () => {
      const inputRow = { id: 'char-1', novel_id: 'novel-1', name: '陆沉舟' };
      const out = applyFkRelationships(
        'novel_characters',
        [inputRow],
        fkSpec,
        { novels: novelInstanceIdByExternalId },
      );
      expect(out).toHaveLength(1);
      expect(out[0].relationships).toEqual({ belongsTo: 'platform-novel-1' });
    });

    it('keeps the original row data in the output', () => {
      const inputRow = { id: 'char-1', novel_id: 'novel-1', name: '陆沉舟' };
      const [out] = applyFkRelationships(
        'novel_characters',
        [inputRow],
        fkSpec,
        { novels: novelInstanceIdByExternalId },
      );
      expect(out.row).toEqual(inputRow);
    });

    it('throws when an FK value has no matching target instance (no silent drops)', () => {
      const inputRow = { id: 'char-1', novel_id: 'unknown-novel', name: '陆沉舟' };
      expect(() =>
        applyFkRelationships('novel_characters', [inputRow], fkSpec, { novels: novelInstanceIdByExternalId }),
      ).toThrow(/novel_characters.*novel_id.*unknown-novel/);
    });
  });

  describe('multi-FK on the same row (Chapter.novel_id + Chapter.outline_id)', () => {
    const fkSpec: FkSpec = [
      { sourceTable: 'novel_chapters', sourceColumn: 'novel_id', relationshipName: 'belongsTo', targetTable: 'novels' },
      { sourceTable: 'novel_chapters', sourceColumn: 'outline_id', relationshipName: 'followsOutline', targetTable: 'novel_plot_outlines' },
    ];
    const lookup = {
      novels: { 'n-1': 'platform-n-1' },
      novel_plot_outlines: { 'po-1': 'platform-po-1' },
    };

    it('produces both relationship entries on the same row', () => {
      const row = { id: 'ch-1', novel_id: 'n-1', outline_id: 'po-1', title: 'ch1' };
      const [out] = applyFkRelationships('novel_chapters', [row], fkSpec, lookup);
      expect(out.relationships).toEqual({
        belongsTo: 'platform-n-1',
        followsOutline: 'platform-po-1',
      });
    });
  });

  describe('nullable FK (PlotOutline.parent_id is optional)', () => {
    const fkSpec: FkSpec = [
      { sourceTable: 'novel_plot_outlines', sourceColumn: 'novel_id', relationshipName: 'belongsTo', targetTable: 'novels' },
      { sourceTable: 'novel_plot_outlines', sourceColumn: 'parent_id', relationshipName: 'parent', targetTable: 'novel_plot_outlines' },
    ];
    const lookup = {
      novels: { 'n-1': 'platform-n-1' },
      novel_plot_outlines: { 'po-root': 'platform-po-root' },
    };

    it('omits the relationship entry entirely when the FK value is null (not a null value, not an empty string)', () => {
      const row = { id: 'po-root', novel_id: 'n-1', parent_id: null, title: 'root' };
      const [out] = applyFkRelationships('novel_plot_outlines', [row], fkSpec, lookup);
      expect(out.relationships).toEqual({ belongsTo: 'platform-n-1' });
      expect('parent' in out.relationships).toBe(false);
    });

    it('omits the relationship entry when the FK value is undefined', () => {
      const row = { id: 'po-root', novel_id: 'n-1', title: 'root' } as unknown as Record<string, unknown>;
      const [out] = applyFkRelationships('novel_plot_outlines', [row], fkSpec, lookup);
      expect(out.relationships).toEqual({ belongsTo: 'platform-n-1' });
    });
  });

  describe('self-reference (PlotOutline.parent_id → PlotOutline)', () => {
    const fkSpec: FkSpec = [
      { sourceTable: 'novel_plot_outlines', sourceColumn: 'novel_id', relationshipName: 'belongsTo', targetTable: 'novels' },
      { sourceTable: 'novel_plot_outlines', sourceColumn: 'parent_id', relationshipName: 'parent', targetTable: 'novel_plot_outlines' },
    ];
    const lookup = {
      novels: { 'n-1': 'platform-n-1' },
      novel_plot_outlines: {
        'po-root': 'platform-po-root',
        'po-child': 'platform-po-child',
      },
    };

    it('resolves a self-referential FK against its own table lookup', () => {
      const child = { id: 'po-child', novel_id: 'n-1', parent_id: 'po-root', title: 'child' };
      const [out] = applyFkRelationships('novel_plot_outlines', [child], fkSpec, lookup);
      expect(out.relationships).toEqual({
        belongsTo: 'platform-n-1',
        parent: 'platform-po-root',
      });
    });
  });
});
