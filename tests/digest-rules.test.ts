import { describe, expect, it } from 'vitest';
import { defaultFilters, selectPoints } from '../src/domain/rank';
import type { Filters } from '../src/domain/schema';
import { dataset, point, referencePoints } from './support/reference';

const base = defaultFilters(dataset);
const signature = (filters: Filters) =>
  selectPoints(referencePoints, dataset, filters)
    .map((r) => `${r.point.id}:${r.urgency}:${r.relevance}`)
    .join(',');
const ids = (filters: Filters) =>
  selectPoints(referencePoints, dataset, filters).map((r) => r.point.threadId);

const users = dataset.users.map((u) => u.id);
const projects = ['all', ...dataset.projects.map((p) => p.id)];
const focuses = ['design', 'validation', 'supply'] as const;
function validCombinations(): Filters[] {
  const result: Filters[] = [];
  for (const userId of users)
    for (const projectId of projects)
      for (const focus of focuses) {
        if (projectId === 'all') result.push({ userId, projectId, relationship: null, focus });
        else
          for (const relationship of ['owner', 'follower'] as const)
            result.push({ userId, projectId, relationship, focus });
      }
  return result;
}
function neighbors(f: Filters): Filters[] {
  const out: Filters[] = [];
  for (const userId of users) if (userId !== f.userId) out.push({ ...f, userId });
  for (const projectId of projects)
    if (projectId !== f.projectId)
      out.push(
        { ...f, projectId, relationship: projectId === 'all' ? null : 'owner' },
        ...(projectId === 'all' ? [] : [{ ...f, projectId, relationship: 'follower' as const }]),
      );
  for (const focus of focuses) if (focus !== f.focus) out.push({ ...f, focus });
  if (f.projectId !== 'all')
    out.push({ ...f, relationship: f.relationship === 'owner' ? 'follower' : 'owner' });
  return out;
}

describe('Digest rules', () => {
  it('changes the digest when any single filter changes, from every valid combination', () => {
    const combos = validCombinations();
    expect(combos).toHaveLength(30);
    const failures: string[] = [];
    for (const filters of combos) {
      for (const next of neighbors(filters)) {
        // Changing project and relationship together is not a single-filter change unless one is implied.
        const changed = (Object.keys(filters) as (keyof Filters)[]).filter((k) => filters[k] !== next[k]);
        if (changed.length > 1 && !(changed.includes('projectId') && changed.includes('relationship')))
          continue;
        if (signature(filters) === signature(next))
          failures.push(`${JSON.stringify(filters)} -> ${JSON.stringify(next)}`);
      }
    }
    expect(failures).toEqual([]);
  });
  it('labels and orders by urgency, then relevance', () => {
    const digest = selectPoints(referencePoints, dataset, {
      userId: 'alex',
      projectId: 'robot-arm',
      relationship: 'owner',
      focus: 'validation',
    });
    expect(digest[0]).toMatchObject({ urgency: 'high', relevance: 'high' });
    expect(digest[0]?.point.threadId).toBe('ra-wrist-thermal');
    const order = { high: 0, medium: 1, low: 2 };
    const open = digest.filter((r) => !r.resolved);
    for (let i = 1; i < open.length; i++)
      expect(order[open[i]!.urgency]).toBeGreaterThanOrEqual(order[open[i - 1]!.urgency]);
  });
  it('uses exact identity for assignments: the same point is high relevance only for its assignee', () => {
    const alex = selectPoints([point('mb-cell-allocation')], dataset, {
      userId: 'alex',
      projectId: 'mobile-base',
      relationship: 'follower',
      focus: 'supply',
    });
    const sam = selectPoints([point('mb-cell-allocation')], dataset, {
      userId: 'sam',
      projectId: 'mobile-base',
      relationship: 'follower',
      focus: 'supply',
    });
    expect(alex[0]?.relevance).toBe('medium');
    expect(sam[0]?.relevance).toBe('high');
    expect(alex[0]?.point).toEqual(sam[0]?.point);
  });
  it('respects project scope even for blockers', () => {
    expect(
      ids({ ...base, projectId: 'mobile-base', relationship: null }).every((id) => id.startsWith('mb-')),
    ).toBe(true);
  });
  it('keeps carry-over assignments, drops stale updates, chatter, and future points', () => {
    expect(ids({ ...base, focus: 'design' })).toContain('ra-tooling-approval');
    expect(ids({ ...base, userId: 'sam', focus: 'supply' })).not.toContain('ra-tooling-approval');
    for (const userId of users)
      for (const focus of focuses) expect(ids({ ...base, userId, focus })).not.toContain('mb-packaging-old');
    const future = point('ra-housing-vent', { timestamp: '2026-10-01T18:00:00Z' });
    expect(selectPoints([future], dataset, base)).toEqual([]);
  });
  it('shows at most 6 open points and one relevant resolved point, never as pending', () => {
    for (const filters of validCombinations()) {
      const digest = selectPoints(referencePoints, dataset, filters);
      expect(digest.filter((r) => !r.resolved).length).toBeLessThanOrEqual(6);
      expect(digest.filter((r) => r.resolved).length).toBeLessThanOrEqual(1);
      for (const r of digest.filter((r) => r.resolved)) expect(r.urgency).toBe('low');
    }
  });
  it('is deterministic and independent of input order and duplicates', () => {
    const forward = selectPoints(referencePoints, dataset, base);
    expect(selectPoints([...referencePoints].reverse().concat(referencePoints), dataset, base)).toEqual(
      forward,
    );
  });
  it('rejects unknown users and projects', () => {
    expect(() => selectPoints(referencePoints, dataset, { ...base, userId: 'nobody' })).toThrow(
      'Unknown user',
    );
    expect(() => selectPoints(referencePoints, dataset, { ...base, projectId: 'nowhere' })).toThrow(
      'Unknown project',
    );
  });
});
