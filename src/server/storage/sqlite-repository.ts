import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { BriefSchema, FiltersSchema, type Brief } from '../../domain/schema';
import type { CallLog, DigestRepository, StoredDigest } from './ports';

const StoredDigestRowSchema = z.object({
  key: z.string(),
  userId: z.string(),
  filters: FiltersSchema,
  items: z.array(z.object({ pointId: z.string(), text: z.string() })),
  aiSummarized: z.boolean(),
  model: z.string(),
  createdAt: z.string(),
});

const SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 3000;
  CREATE TABLE IF NOT EXISTS thread_briefs (
    thread_id TEXT NOT NULL, content_hash TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (thread_id, content_hash));
  CREATE TABLE IF NOT EXISTS digests (
    cache_key TEXT PRIMARY KEY, user_id TEXT NOT NULL, filters TEXT NOT NULL, items TEXT NOT NULL,
    ai_summarized INTEGER NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS llm_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
    model TEXT NOT NULL, status TEXT NOT NULL, tokens INTEGER NOT NULL, latency_ms INTEGER NOT NULL, error TEXT);
  PRAGMA user_version = 2;`;

/** SQLite implementation of the storage ports. Read-only mode lets scripts inspect a live database safely. */
export class SqliteRepository implements DigestRepository {
  private readonly db: DatabaseSync;

  constructor(path: string, options: { readOnly?: boolean } = {}) {
    if (options.readOnly) {
      if (path !== ':memory:' && !existsSync(path)) {
        throw new Error(`No database found at ${path}. Press Run Digest first.`);
      }
      this.db = new DatabaseSync(path, { readOnly: true });
      return;
    }
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA_SQL);
  }

  getBrief(threadId: string, contentHash: string): Brief | null {
    const row = this.db
      .prepare('SELECT payload FROM thread_briefs WHERE thread_id = ? AND content_hash = ?')
      .get(threadId, contentHash);
    return row ? BriefSchema.parse(JSON.parse(String(row.payload))) : null;
  }

  saveBrief(brief: Brief): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO thread_briefs (thread_id, content_hash, payload, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(brief.threadId, brief.contentHash, JSON.stringify(brief), brief.createdAt);
  }

  getDigest(key: string): StoredDigest | null {
    const row = this.db.prepare('SELECT * FROM digests WHERE cache_key = ?').get(key);
    if (!row) return null;
    return StoredDigestRowSchema.parse({
      key: row.cache_key,
      userId: row.user_id,
      filters: JSON.parse(String(row.filters)),
      items: JSON.parse(String(row.items)),
      aiSummarized: row.ai_summarized === 1,
      model: row.model,
      createdAt: row.created_at,
    });
  }

  saveDigest(digest: StoredDigest): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO digests (cache_key, user_id, filters, items, ai_summarized, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        digest.key,
        digest.userId,
        JSON.stringify(digest.filters),
        JSON.stringify(digest.items),
        digest.aiSummarized ? 1 : 0,
        digest.model,
        digest.createdAt,
      );
  }

  logCall(call: CallLog): void {
    this.db
      .prepare(
        'INSERT INTO llm_calls (created_at, kind, target, model, status, tokens, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        new Date().toISOString(),
        call.kind,
        call.target,
        call.model,
        call.status,
        call.tokens,
        call.latencyMs,
        call.error,
      );
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}
