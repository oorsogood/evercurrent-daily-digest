import { createHash } from 'node:crypto';
import type { RankedPoint } from '../../domain/rank';
import type { Dataset, Thread } from '../../domain/schema';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** A brief is reused only while its thread content is unchanged. */
export const hashThread = (thread: Thread): string => sha256(JSON.stringify(thread));

export const hashThreads = (dataset: Dataset): ReadonlyMap<string, string> =>
  new Map(dataset.threads.map((t) => [t.id, hashThread(t)]));

/**
 * Keyed by what was selected, not by the filters, so different filters with the same selection
 * share one digest, and any change to the underlying briefs produces a new key.
 */
export function digestKey(
  userId: string,
  ranked: readonly RankedPoint[],
  threadHashes: ReadonlyMap<string, string>,
): string {
  const signature = ranked.map((r) => [
    r.point.id,
    threadHashes.get(r.point.threadId),
    r.urgency,
    r.relevance,
  ]);
  return sha256(JSON.stringify({ userId, signature }));
}
