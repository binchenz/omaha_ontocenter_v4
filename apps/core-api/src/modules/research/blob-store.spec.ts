import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { LocalBlobStore } from './blob-store';

describe('LocalBlobStore', () => {
  let dir: string;
  let store: LocalBlobStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blobstore-'));
    store = new LocalBlobStore(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('round-trips a stored buffer through its returned reference', async () => {
    const content = Buffer.from('纯米调研报告内容', 'utf8');
    const ref = await store.store(content, 'report.pdf');
    const got = await store.get(ref);
    expect(got.equals(content)).toBe(true);
  });

  it('preserves the original file extension in the reference', async () => {
    const ref = await store.store(Buffer.from('x'), '艾瑞2025Q2.pdf');
    expect(ref.endsWith('.pdf')).toBe(true);
  });

  it('gives distinct references to two files with the same name', async () => {
    const a = await store.store(Buffer.from('a'), 'same.pdf');
    const b = await store.store(Buffer.from('b'), 'same.pdf');
    expect(a).not.toBe(b);
    expect((await store.get(a)).toString()).toBe('a');
    expect((await store.get(b)).toString()).toBe('b');
  });

  it('rejects a reference that escapes the base directory', async () => {
    await expect(store.get('../../etc/passwd')).rejects.toThrow();
  });
});
