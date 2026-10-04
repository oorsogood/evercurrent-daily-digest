/**
 * Storage ports. Application code depends on these interfaces, never on SQLite directly,
 * so the database can be replaced without touching the digest pipeline.
 */
import type { Brief, Filters } from '../../domain/schema';

export interface StoredDigest {
  key: string;
  userId: string;
  filters: Filters;
  items: { pointId: string; text: string }[];
  aiSummarized: boolean;
  model: string;
  createdAt: string;
}

export type CallKind = 'brief' | 'digest';

export interface CallLog {
  kind: CallKind;
  target: string;
  model: string;
  status: 'ok' | 'error' | 'invalid';
  tokens: number;
  latencyMs: number;
  error: string | null;
}

export interface BriefStore {
  getBrief(threadId: string, contentHash: string): Brief | null;
  saveBrief(brief: Brief): void;
}

export interface DigestStore {
  getDigest(key: string): StoredDigest | null;
  saveDigest(digest: StoredDigest): void;
}

export interface CallLogStore {
  logCall(call: CallLog): void;
}

export type DigestRepository = BriefStore & DigestStore & CallLogStore;
