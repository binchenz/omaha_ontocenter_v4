import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Persistent storage for original ingested files (ADR-0042 §2). Unlike the ephemeral
 * `uploads/` dir used for transient tabular imports, a blob survives so a research-document
 * citation ("据 <机构> 报告第 N 页") can resolve back to an openable original. The interface
 * is deliberately tiny — store bytes, get bytes by reference — so the backing store (local
 * disk now, object store later) can change without touching callers.
 */
export interface BlobStore {
  store(content: Buffer, originalName: string): Promise<string>;
  get(ref: string): Promise<Buffer>;
}

export const BLOB_STORE = Symbol('BLOB_STORE');

/** Local-disk BlobStore: one file per blob under `baseDir`, keyed by an opaque reference. */
export class LocalBlobStore implements BlobStore {
  constructor(private readonly baseDir: string) {}

  async store(content: Buffer, originalName: string): Promise<string> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const ref = `${randomUUID()}${path.extname(originalName)}`;
    await fs.writeFile(this.resolve(ref), content);
    return ref;
  }

  async get(ref: string): Promise<Buffer> {
    return fs.readFile(this.resolve(ref));
  }

  /** Resolve a reference to an absolute path, rejecting any that escapes `baseDir`. */
  private resolve(ref: string): string {
    const full = path.resolve(this.baseDir, ref);
    const root = path.resolve(this.baseDir);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`Invalid blob reference: ${ref}`);
    }
    return full;
  }
}
