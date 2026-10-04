import type { Brief } from '../../src/domain/schema';
import type { CallLog, DigestRepository, StoredDigest } from '../../src/server/storage/ports';

/** In-memory implementation of the storage ports, used to show the pipeline does not depend on SQLite. */
export class MemoryRepository implements DigestRepository {
  readonly briefs = new Map<string, Brief>();
  readonly digests = new Map<string, StoredDigest>();
  readonly calls: CallLog[] = [];

  getBrief(threadId: string, contentHash: string): Brief | null {
    return this.briefs.get(`${threadId}:${contentHash}`) ?? null;
  }
  saveBrief(brief: Brief): void {
    this.briefs.set(`${brief.threadId}:${brief.contentHash}`, brief);
  }
  getDigest(key: string): StoredDigest | null {
    return this.digests.get(key) ?? null;
  }
  saveDigest(digest: StoredDigest): void {
    this.digests.set(digest.key, digest);
  }
  logCall(call: CallLog): void {
    this.calls.push(call);
  }
}
