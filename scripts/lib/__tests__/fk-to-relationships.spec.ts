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
});
