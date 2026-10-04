import type { DigestItemView, DigestView } from '../../domain/contracts';
import { normalizeFilters, selectPoints } from '../../domain/rank';
import type { Dataset, Filters, Point } from '../../domain/schema';
import type { BriefStore, DigestStore } from '../storage/ports';
import { digestKey } from './cache-keys';

export interface CachedPoints {
  points: Point[];
  analyzed: number;
}

/** Read side: answers filter changes from the cache. Never calls the LLM. */
export class DigestQuery {
  constructor(
    private readonly store: BriefStore & DigestStore,
    private readonly dataset: Dataset,
    private readonly threadHashes: ReadonlyMap<string, string>,
  ) {}

  /** Points from every thread whose brief matches its current content. */
  cachedPoints(): CachedPoints {
    const points: Point[] = [];
    let analyzed = 0;
    for (const thread of this.dataset.threads) {
      const brief = this.store.getBrief(thread.id, this.threadHashes.get(thread.id)!);
      if (!brief) continue;
      analyzed++;
      points.push(...brief.points);
    }
    return { points, analyzed };
  }

  view(rawFilters: Filters): DigestView {
    const filters = normalizeFilters(this.dataset, rawFilters);
    const { points, analyzed } = this.cachedPoints();
    const coverage = { analyzed, total: this.dataset.threads.length };
    const base = { filters, coverage, digest: null, reason: null };
    if (analyzed === 0) {
      return { ...base, state: 'not-generated', reason: 'Threads have not been analyzed yet.' };
    }

    const ranked = selectPoints(points, this.dataset, filters);
    if (!ranked.length) return { ...base, state: 'empty' };
    const stored = this.store.getDigest(digestKey(filters.userId, ranked, this.threadHashes));
    if (!stored) return { ...base, state: 'not-generated' };

    const text = new Map(stored.items.map((i) => [i.pointId, i.text]));
    const items = ranked.map((r, index): DigestItemView => ({
      ref: `P${index + 1}`,
      pointId: r.point.id,
      threadId: r.point.threadId,
      projectId: r.point.projectId,
      urgency: r.urgency,
      relevance: r.relevance,
      resolved: r.resolved,
      text: text.get(r.point.id) ?? r.point.summary,
      messageIds: r.point.messageIds,
    }));
    return {
      ...base,
      state: 'ready',
      digest: {
        key: stored.key,
        createdAt: stored.createdAt,
        model: stored.model,
        aiSummarized: stored.aiSummarized,
        items,
      },
    };
  }
}
