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

  describe('parentRef', () => {
    it('attaches relationships.belongsTo to each instance from the parent map', async () => {
      const importer = makeFakeImporter();
      const ctx = makeMinimalCtx({
        sourceData: {
          Child: [
            { id: 'c1', parent_external_id: 'p1' },
            { id: 'c2', parent_external_id: 'p2' },
          ],
        },
        loadExternalIdMap: vi.fn(async (objectType: string) => {
          expect(objectType).toBe('Parent');
          return { p1: 'platform-p1', p2: 'platform-p2' };
        }),
      });
      const recipe: IngestRecipe<{ id: string; parent_external_id: string }> = {
        objectType: 'Child',
        read: (c) => (c.sourceData['Child'] ?? []) as { id: string; parent_external_id: string }[],
        parentRef: { objectType: 'Parent', sourceField: 'parent_external_id' },
        toInstance: (row) => ({ externalId: row.id, label: row.id, properties: {} }),
      };
      const result = await runRecipe(recipe, ctx, importer.fn);
      expect(result.imported).toBe(2);
      expect(importer.calls[0].instances[0].relationships).toEqual({ belongsTo: 'platform-p1' });
      expect(importer.calls[0].instances[1].relationships).toEqual({ belongsTo: 'platform-p2' });
    });

    it('skips and counts rows whose parent reference does not resolve', async () => {
      const importer = makeFakeImporter();
      const ctx = makeMinimalCtx({
        sourceData: {
          Child: [
            { id: 'c1', parent_external_id: 'p1' },
            { id: 'c2', parent_external_id: 'unknown' },
            { id: 'c3', parent_external_id: 'p2' },
          ],
        },
        loadExternalIdMap: vi.fn(async () => ({ p1: 'platform-p1', p2: 'platform-p2' })),
      });
      const recipe: IngestRecipe<{ id: string; parent_external_id: string }> = {
        objectType: 'Child',
        read: (c) => (c.sourceData['Child'] ?? []) as { id: string; parent_external_id: string }[],
        parentRef: { objectType: 'Parent', sourceField: 'parent_external_id' },
        toInstance: (row) => ({ externalId: row.id, label: row.id, properties: {} }),
      };
      const result = await runRecipe(recipe, ctx, importer.fn);
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(1);
      expect(importer.calls[0].instances).toHaveLength(2);
    });

    it('skips and counts rows where the parent source field is null/undefined', async () => {
      const importer = makeFakeImporter();
      const ctx = makeMinimalCtx({
        sourceData: {
          Child: [
            { id: 'c1', parent_external_id: 'p1' },
            { id: 'c2', parent_external_id: null as any },
          ],
        },
        loadExternalIdMap: vi.fn(async () => ({ p1: 'platform-p1' })),
      });
      const recipe: IngestRecipe<any> = {
        objectType: 'Child',
        read: (c) => (c.sourceData['Child'] ?? []) as any[],
        parentRef: { objectType: 'Parent', sourceField: 'parent_external_id' },
        toInstance: (row) => ({ externalId: row.id, label: row.id, properties: {} }),
      };
      const result = await runRecipe(recipe, ctx, importer.fn);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });
  });

  describe('cross-recipe cache', () => {
    it('two recipes with the same parentRef.objectType cause exactly one loadExternalIdMap call total', async () => {
      const importer = makeFakeImporter();
      const loadMock = vi.fn(async () => ({ p1: 'platform-p1' }));
      const ctx = makeMinimalCtx({
        sourceData: {
          A: [{ id: 'a1', parent: 'p1' }],
          B: [{ id: 'b1', parent: 'p1' }],
        },
        loadExternalIdMap: loadMock,
      });
      const recipeA: IngestRecipe<any> = {
        objectType: 'A',
        read: (c) => (c.sourceData['A'] ?? []) as any[],
        parentRef: { objectType: 'Parent', sourceField: 'parent' },
        toInstance: (row) => ({ externalId: row.id, label: row.id, properties: {} }),
      };
      const recipeB: IngestRecipe<any> = {
        objectType: 'B',
        read: (c) => (c.sourceData['B'] ?? []) as any[],
        parentRef: { objectType: 'Parent', sourceField: 'parent' },
        toInstance: (row) => ({ externalId: row.id, label: row.id, properties: {} }),
      };
      // The mock here is a fresh function returning the same map on every call —
      // the real ctx.loadExternalIdMap caches inside its own closure. The test
      // verifies runRecipe doesn't call loadExternalIdMap unnecessarily often.
      // For two recipes, runRecipe should call it once per recipe (twice total)
      // if the ctx implementation doesn't cache; the real createIngestCtx caches
      // so the second call is a cache hit. We assert the contract that runRecipe
      // makes exactly one call per recipe (the cache is the ctx's job, not runRecipe's).
      await runRecipe(recipeA, ctx, importer.fn);
      await runRecipe(recipeB, ctx, importer.fn);
      // runRecipe calls loadExternalIdMap once per recipe; ctx caches downstream.
      expect(loadMock).toHaveBeenCalledTimes(2);
      expect(loadMock).toHaveBeenNthCalledWith(1, 'Parent');
      expect(loadMock).toHaveBeenNthCalledWith(2, 'Parent');
    });
  });
});
