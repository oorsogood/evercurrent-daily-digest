import { describe, expect, it } from 'vitest';
import { evaluateBriefs } from '../src/domain/evaluate';
import type { Point } from '../src/domain/schema';
import { dataset, referenceBriefs, referencePoints } from './support/reference';

const ids = dataset.threads.map((t) => t.id);
const byThread = (points: Point[] = referencePoints) => {
  const m = new Map<string, Point[]>();
  for (const t of ids)
    m.set(
      t,
      points.filter((p) => p.threadId === t),
    );
  return m;
};
const edit = (threadId: string, change: Partial<Point>) =>
  referencePoints.map((p) => (p.threadId === threadId ? { ...p, ...change } : p));
const result = (report: ReturnType<typeof evaluateBriefs>, threadId: string) =>
  report.results.find((r) => r.threadId === threadId)!;

describe('Brief evaluation', () => {
  it('passes the reference against itself', () => {
    const report = evaluateBriefs(referenceBriefs, byThread(), ids);
    expect(report.passed).toBe(true);
    expect(report.advisoryCount).toBe(0);
    expect(report.extraPoints).toBe(0);
  });
  it('fails objective errors: assignees, due dates, missed blockers, and resolved state', () => {
    const cases: [string, Partial<Point>, RegExp][] = [
      ['ra-wrist-thermal', { assigneeIds: [] }, /assignees/],
      ['ra-cable-routing', { dueDate: null }, /dueDate/],
      ['ra-bearing-delay', { type: 'action' }, /blocker missed/],
      ['mb-bracket-decision', { status: 'resolved' }, /status resolved/],
    ];
    for (const [threadId, change, pattern] of cases) {
      const report = evaluateBriefs(referenceBriefs, byThread(edit(threadId, change)), ids);
      expect(report.passed).toBe(false);
      expect(result(report, threadId).failures.join()).toMatch(pattern);
    }
  });
  it('treats judgment calls as advisory and does not fail them', () => {
    const report = evaluateBriefs(
      referenceBriefs,
      byThread(edit('ra-connector-fixed', { type: 'decision' })),
      ids,
    );
    const statusOnly = evaluateBriefs(
      referenceBriefs,
      byThread(edit('mb-battery-drop', { status: 'needs-confirmation' })),
      ids,
    );
    expect(report.passed).toBe(true);
    expect(result(report, 'ra-connector-fixed').advisories.join()).toMatch(/type decision/);
    expect(statusOnly.passed).toBe(true);
    expect(result(statusOnly, 'mb-battery-drop').advisories.join()).toMatch(/needs-confirmation/);
  });
  it('fails a missing point only when it carries an assignment, a deadline, or a blocker', () => {
    const withoutUpdate = byThread();
    withoutUpdate.set('ra-housing-vent', []);
    expect(evaluateBriefs(referenceBriefs, withoutUpdate, ids).passed).toBe(true);
    const withoutAssignment = byThread();
    withoutAssignment.set('mb-caster-supplier', []);
    expect(evaluateBriefs(referenceBriefs, withoutAssignment, ids).passed).toBe(false);
    const missingThread = byThread();
    missingThread.delete('mb-fan-noise');
    expect(result(evaluateBriefs(referenceBriefs, missingThread, ids), 'mb-fan-noise').failures).toEqual([
      'thread not analyzed',
    ]);
  });
});
