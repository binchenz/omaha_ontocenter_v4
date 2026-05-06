import { describe, it, expect, vi } from 'vitest';
import { runRecipe, type IngestRecipe, type IngestCtx } from '../run-recipe';
import type { InstanceInput } from '../object-instance-importer';

function makeFakeImporter() {
  const calls: Array<{ objectType: string; instances: InstanceInput[] }> = [];
  const fn = vi.fn(async (_prisma: unknown, _tenantId: string, objectType: string, instances: InstanceInput[]) => {
    calls.push({ objectType, instances });
    return { imported: instances.length, updated: 0, skipped: 0 };
  });
  return { fn, calls };
}

function makeMinimalCtx(overrides: Partial<IngestCtx> = {}): IngestCtx {
  return {
    prisma: {} as any,
    tenantId: 't1',
    reader: {} as any,
    sourceData: {},
    externalIdMaps: new Map(),
    candidatePools: new Map(),
    loadExternalIdMap: vi.fn(),
    loadCandidatePool: vi.fn(),
    ...overrides,
  } as IngestCtx;
}

describe('runRecipe', () => {
  describe('minimal recipe (no parentRef, no entityResolution, no relationships callback)', () => {
    it('reads rows, maps each to an instance, calls importer once with the result, returns four-counter result', async () => {
      const importer = makeFakeImporter();
      const recipe: IngestRecipe<{ id: string; name: string }> = {
        objectType: 'Book',
        read: () => [
          { id: 'b1', name: 'first' },
          { id: 'b2', name: 'second' },
        ],
        toInstance: (row) => ({
          externalId: row.id,
          label: row.name,
          properties: { name: row.name },
        }),
      };

      const result = await runRecipe(recipe, makeMinimalCtx(), importer.fn);

      expect(result).toEqual({ imported: 2, updated: 0, skipped: 0, errors: 0 });
      expect(importer.calls).toHaveLength(1);
      expect(importer.calls[0].objectType).toBe('Book');
      expect(importer.calls[0].instances).toHaveLength(2);
      expect(importer.calls[0].instances[0]).toMatchObject({
        externalId: 'b1',
        label: 'first',
        properties: { name: 'first' },
      });
    });

    it('returns zero-counter result when read returns empty array', async () => {
      const importer = makeFakeImporter();
      const recipe: IngestRecipe<unknown> = {
        objectType: 'Book',
        read: () => [],
        toInstance: () => ({ externalId: 'x', label: 'x', properties: {} }),
      };
      const result = await runRecipe(recipe, makeMinimalCtx(), importer.fn);
      expect(result).toEqual({ imported: 0, updated: 0, skipped: 0, errors: 0 });
      expect(importer.calls).toHaveLength(0);
    });

    it('reads from ctx.sourceData via the recipe.read pull', async () => {
      const importer = makeFakeImporter();
      const recipe: IngestRecipe<{ id: string }> = {
        objectType: 'X',
        read: (ctx) => (ctx.sourceData['X'] ?? []) as { id: string }[],
        toInstance: (row) => ({ externalId: row.id, label: row.id, properties: {} }),
      };
      const ctx = makeMinimalCtx({ sourceData: { X: [{ id: 'r1' }, { id: 'r2' }] } });
      const result = await runRecipe(recipe, ctx, importer.fn);
      expect(result.imported).toBe(2);
    });
  });
});
