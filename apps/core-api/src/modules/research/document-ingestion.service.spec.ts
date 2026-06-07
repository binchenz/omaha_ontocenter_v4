import { DocumentIngestionService } from './document-ingestion.service';
import { Chunker } from './chunker';
import { EmbeddingClient } from './embedding/embedding-client.interface';
import { BlobStore } from './blob-store';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

// A fake extractor returning fixed pages, so the test needs no real PDF.
class FakeExtractor {
  pages = [
    { page: 1, text: '高端净水器用户更看重龙头颜值与极致体验。' },
    { page: 2, text: '中端用户最关注滤芯更换价格与使用寿命。' },
  ];
  async extract() {
    return this.pages;
  }
}

// A deterministic fake embedder: one fixed-length vector per input, no network.
class FakeEmbedder implements EmbeddingClient {
  async embedPassages(texts: string[]): Promise<number[][]> {
    return texts.map((_, i) => Array.from({ length: 4 }, (_, j) => (i + 1) * 0.1 + j));
  }
  async embedQuery(): Promise<number[]> {
    return [0, 0, 0, 0];
  }
}

class FakeBlobStore implements BlobStore {
  stored: Array<{ name: string; bytes: number }> = [];
  async store(content: Buffer, name: string): Promise<string> {
    this.stored.push({ name, bytes: content.length });
    return `ref-${this.stored.length}`;
  }
  async get(): Promise<Buffer> {
    return Buffer.from('');
  }
}

describe('DocumentIngestionService', () => {
  let service: DocumentIngestionService;
  let blob: FakeBlobStore;
  let chunkInserts: any[][];
  let createdDocument: any;
  let tmpPdf: string;

  const mockPrisma: any = {
    researchDocument: {
      create: jest.fn(async ({ data }: any) => {
        createdDocument = { id: 'doc-1', ...data };
        return createdDocument;
      }),
    },
    $executeRawUnsafe: jest.fn(async (...args: any[]) => {
      chunkInserts.push(args);
      return 1;
    }),
    // Atomic ingest (#3): document + chunk writes run inside one interactive transaction.
    // The fake runs the callback against the same mocks, so writes still land on the spies.
    $transaction: jest.fn(async (fn: any) => fn(mockPrisma)),
  };

  beforeAll(async () => {
    tmpPdf = path.join(os.tmpdir(), 'ingest-test.pdf');
    await fs.writeFile(tmpPdf, Buffer.from('%PDF-1.4 fake'));
  });

  afterAll(async () => {
    await fs.rm(tmpPdf, { force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    chunkInserts = [];
    createdDocument = undefined;
    blob = new FakeBlobStore();
    service = new DocumentIngestionService(
      mockPrisma,
      new FakeExtractor() as any,
      new Chunker(),
      new FakeEmbedder(),
      blob,
    );
  });

  it('rejects an unknown 品类 before doing any work', async () => {
    await expect(
      service.ingest('t1', tmpPdf, 'report.pdf', { category: '扫地机器人' }),
    ).rejects.toThrow();
    expect(blob.stored).toHaveLength(0);
    expect(mockPrisma.researchDocument.create).not.toHaveBeenCalled();
  });

  it('stores the original file and records a provenance document with its media ref', async () => {
    await service.ingest('t1', tmpPdf, 'report.pdf', {
      category: '净水器',
      agency: '品创方略',
      quarter: '2025Q2',
    });
    expect(blob.stored).toHaveLength(1);
    expect(createdDocument).toMatchObject({
      tenantId: 't1',
      category: '净水器',
      agency: '品创方略',
      quarter: '2025Q2',
      mediaRef: 'ref-1',
    });
  });

  it('persists all chunks in a single batched INSERT, carrying page anchors and embeddings', async () => {
    const result = await service.ingest('t1', tmpPdf, 'report.pdf', { category: '净水器' });
    // The two short pages each fit in one chunk → result reports 2 chunks.
    expect(result.chunks).toBe(2);
    // Batch INSERT: one $executeRawUnsafe call for all chunks (not N individual calls).
    expect(chunkInserts).toHaveLength(1);
    // Layout: [sql, tenantId, docId, cat1, text1, page1, vec1, cat2, text2, page2, vec2]
    const [sql, tenantId, docId, cat1, text1, page1, vec1, , text2, page2] = chunkInserts[0];
    expect(sql).toContain('INSERT INTO "document_chunks"');
    expect(tenantId).toBe('t1');
    expect(docId).toBe('doc-1');
    expect(cat1).toBe('净水器');
    expect(text1).toContain('龙头颜值');
    expect(page1).toBe(1);
    expect(vec1).toMatch(/^\[.*\]$/); // pgvector literal
    expect(text2).toContain('滤芯');
    expect(page2).toBe(2);
  });

  it('writes the document and its chunks inside one transaction', async () => {
    await service.ingest('t1', tmpPdf, 'report.pdf', { category: '净水器' });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects (no orphaned document) when the batch chunk insert fails', async () => {
    // Batch INSERT blows up; with writes inside a transaction the whole ingest rejects
    // so Postgres rolls the document row back rather than leaving it orphaned.
    mockPrisma.$executeRawUnsafe.mockRejectedValueOnce(new Error('insert failed'));
    await expect(
      service.ingest('t1', tmpPdf, 'report.pdf', { category: '净水器' }),
    ).rejects.toThrow('insert failed');
  });
});
