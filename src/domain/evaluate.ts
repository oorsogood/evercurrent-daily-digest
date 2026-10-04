import type { ExtractedPoint, Point } from './schema';

/**
 * Objective checks fail the evaluation because they change what the user sees:
 * assignees, due dates, blocker detection (drives urgency), and resolved state (drives the Resolved section).
 * Other label differences (for example update vs decision) are judgment calls and are reported as advisory only.
 */
export interface PointResult {
  threadId: string;
  expected: string;
  matchedId: string | null;
  failures: string[];
  advisories: string[];
}
export interface EvaluationReport {
  analyzed: number;
  total: number;
  results: PointResult[];
  objectivePassed: number;
  advisoryCount: number;
  extraPoints: number;
  passed: boolean;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();
const isBlocker = (p: Pick<ExtractedPoint, 'type' | 'status'>) =>
  p.type === 'blocker' && p.status !== 'resolved';

function compare(expected: ExtractedPoint, actual: Point): { failures: string[]; advisories: string[] } {
  const failures: string[] = [];
  const advisories: string[] = [];
  if (!sameSet(expected.assigneeIds, actual.assigneeIds))
    failures.push(`assignees [${actual.assigneeIds}] (expected [${expected.assigneeIds}])`);
  if (expected.dueDate !== actual.dueDate)
    failures.push(`dueDate ${actual.dueDate} (expected ${expected.dueDate})`);
  if (isBlocker(expected) !== isBlocker(actual))
    failures.push(
      isBlocker(expected)
        ? `blocker missed (got ${actual.type})`
        : `marked as blocker (expected ${expected.type})`,
    );
  if ((expected.status === 'resolved') !== (actual.status === 'resolved'))
    failures.push(`status ${actual.status} (expected ${expected.status})`);
  else if (expected.status !== actual.status)
    advisories.push(`status ${actual.status} (reference ${expected.status})`);
  if (expected.type !== actual.type && !(isBlocker(expected) || isBlocker(actual)))
    advisories.push(`type ${actual.type} (reference ${expected.type})`);
  return { failures, advisories };
}

/** A missing point only fails when it would have carried an assignment, a deadline, or a blocker. */
const mattersIfMissing = (p: ExtractedPoint) =>
  isBlocker(p) || p.assigneeIds.length > 0 || p.dueDate !== null;

/** Compares cached model briefs with handwritten reference points. Reports differences; never edits model output. */
export function evaluateBriefs(
  reference: Record<string, ExtractedPoint[]>,
  actual: Map<string, Point[]>,
  threadIds: readonly string[],
): EvaluationReport {
  const results: PointResult[] = [];
  let extraPoints = 0;
  for (const threadId of threadIds) {
    const expected = reference[threadId] ?? [];
    const points = actual.get(threadId);
    if (!points) {
      for (const e of expected)
        results.push({
          threadId,
          expected: e.summary,
          matchedId: null,
          failures: ['thread not analyzed'],
          advisories: [],
        });
      continue;
    }
    const used = new Set<string>();
    for (const e of expected) {
      const best = points
        .filter((p) => !used.has(p.id))
        .map((p) => ({ p, ...compare(e, p) }))
        .sort(
          (a, b) => a.failures.length - b.failures.length || a.advisories.length - b.advisories.length,
        )[0];
      if (best) {
        used.add(best.p.id);
        results.push({
          threadId,
          expected: e.summary,
          matchedId: best.p.id,
          failures: best.failures,
          advisories: best.advisories,
        });
        continue;
      }
      const note = 'no point extracted';
      results.push({
        threadId,
        expected: e.summary,
        matchedId: null,
        failures: mattersIfMissing(e) ? [note] : [],
        advisories: mattersIfMissing(e) ? [] : [note],
      });
    }
    extraPoints += points.length - used.size;
  }
  const objectivePassed = results.filter((r) => r.failures.length === 0).length;
  return {
    analyzed: actual.size,
    total: threadIds.length,
    results,
    objectivePassed,
    advisoryCount: results.filter((r) => r.advisories.length > 0).length,
    extraPoints,
    passed: objectivePassed === results.length && actual.size === threadIds.length,
  };
}
