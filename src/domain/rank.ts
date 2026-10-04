import {
  FiltersSchema,
  type Dataset,
  type Filters,
  type Focus,
  type Level,
  type Point,
  type Relationship,
} from './schema';

/** Every tunable number in the ranking lives here. */
export const RANKING = {
  weights: { assigned: 3, focus: 2, owner: 1, role: 1 },
  relevanceThresholds: { high: 3, medium: 2 },
  urgentWithinDays: 2,
  maxOpenPoints: 6,
  maxResolvedPoints: 1,
  minResolvedScore: 2,
} as const;

export const FOCUS_TOPICS: Record<Focus, readonly string[]> = {
  design: ['design'],
  validation: ['testing', 'thermal', 'assembly'],
  supply: ['parts-supply'],
};

const LEVEL_ORDER: Record<Level, number> = { high: 0, medium: 1, low: 2 };
const NO_DUE_DATE = '9999-12-31';
const DAY_MS = 86_400_000;

export interface RankedPoint {
  point: Point;
  urgency: Level;
  relevance: Level;
  score: number;
  resolved: boolean;
}

export const defaultFilters = (dataset: Dataset): Filters => ({
  userId: dataset.users[0]!.id,
  projectId: 'all',
  relationship: null,
  focus: 'validation',
});

/** Validates references and makes relationship explicit for a single project, or null for All Projects. */
export function normalizeFilters(dataset: Dataset, raw: Filters): Filters {
  const filters = FiltersSchema.parse(raw);
  const user = dataset.users.find((u) => u.id === filters.userId);
  if (!user) throw new RangeError('Unknown user.');
  if (filters.projectId === 'all') return { ...filters, relationship: null };
  if (!dataset.projects.some((p) => p.id === filters.projectId)) {
    throw new RangeError('Unknown project.');
  }
  return {
    ...filters,
    relationship: filters.relationship ?? user.relationships[filters.projectId] ?? 'follower',
  };
}

const addDays = (isoDate: string, days: number) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

function relevanceLevel(score: number): Level {
  if (score >= RANKING.relevanceThresholds.high) return 'high';
  if (score >= RANKING.relevanceThresholds.medium) return 'medium';
  return 'low';
}

function urgencyLevel(point: Point, assigned: boolean, urgentBy: string): Level {
  if (point.status === 'resolved') return 'low';
  const dueSoon = point.dueDate !== null && point.dueDate <= urgentBy;
  if (point.type === 'blocker' || dueSoon) return 'high';
  if (point.dueDate !== null || point.status === 'needs-confirmation' || point.type === 'risk' || assigned) {
    return 'medium';
  }
  return 'low';
}

function compareRanked(a: RankedPoint, b: RankedPoint): number {
  return (
    LEVEL_ORDER[a.urgency] - LEVEL_ORDER[b.urgency] ||
    b.score - a.score ||
    (a.point.dueDate ?? NO_DUE_DATE).localeCompare(b.point.dueDate ?? NO_DUE_DATE) ||
    Date.parse(b.point.timestamp) - Date.parse(a.point.timestamp) ||
    a.point.id.localeCompare(b.point.id)
  );
}

/**
 * Pure ranking: scope, labels, order, and selection. No I/O and no LLM.
 * Labels are derived from the same matches that drive the order.
 */
export function selectPoints(points: readonly Point[], dataset: Dataset, rawFilters: Filters): RankedPoint[] {
  const filters = normalizeFilters(dataset, rawFilters);
  const user = dataset.users.find((u) => u.id === filters.userId)!;
  const cutoff = Date.parse(dataset.cutoff);
  const dayStart = Date.parse(dataset.dayStart);
  const urgentBy = addDays(dataset.date, RANKING.urgentWithinDays);
  const { weights } = RANKING;
  const seen = new Set<string>();
  const ranked: RankedPoint[] = [];

  for (const point of points) {
    if (seen.has(point.id)) continue;
    seen.add(point.id);
    if (filters.projectId !== 'all' && point.projectId !== filters.projectId) continue;
    const defaultRelationship = user.relationships[point.projectId];
    if (!defaultRelationship) continue;
    const relationship: Relationship =
      filters.projectId === 'all' ? defaultRelationship : filters.relationship!;

    const timestamp = Date.parse(point.timestamp);
    if (timestamp > cutoff) continue;
    const resolved = point.status === 'resolved';
    const assigned = point.assigneeIds.includes(user.id);
    const blocker = point.type === 'blocker' && !resolved;
    // Carry-over from before today: keep only unresolved assignments and blockers.
    if (timestamp < dayStart && (resolved || (!assigned && !blocker))) continue;

    const focus = point.topics.some((t) => FOCUS_TOPICS[filters.focus].includes(t));
    const role = point.relevantRoles.includes(user.role);
    const score =
      (assigned ? weights.assigned : 0) +
      (focus ? weights.focus : 0) +
      (relationship === 'owner' ? weights.owner : 0) +
      (role ? weights.role : 0);
    if (score === 0 && !blocker) continue;

    ranked.push({
      point,
      urgency: urgencyLevel(point, assigned, urgentBy),
      relevance: relevanceLevel(score),
      score,
      resolved,
    });
  }

  ranked.sort(compareRanked);
  const open = ranked.filter((r) => !r.resolved).slice(0, RANKING.maxOpenPoints);
  const closed = ranked
    .filter((r) => r.resolved && r.score >= RANKING.minResolvedScore)
    .slice(0, RANKING.maxResolvedPoints);
  return [...open, ...closed];
}
