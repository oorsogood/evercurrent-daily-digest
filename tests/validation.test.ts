import { describe, expect, it } from 'vitest';
import { mentionsDate, parseDigestLines, validateBrief } from '../src/domain/validate';
import { dataset, referenceOutput } from './support/reference';

const thread = dataset.threads.find((t) => t.id === 'ra-wrist-thermal')!;
describe('Stage 1 brief validation', () => {
  it('accepts every handwritten reference brief and derives identity from sources', () => {
    for (const t of dataset.threads) {
      const points = validateBrief(referenceOutput(t.id), t, dataset);
      for (const [i, p] of points.entries()) {
        expect(p.id).toBe(`${t.id}:${i + 1}`);
        expect(p.projectId).toBe(t.projectId);
      }
    }
    expect(
      validateBrief(
        referenceOutput('ra-standup'),
        dataset.threads.find((t) => t.id === 'ra-standup')!,
        dataset,
      ),
    ).toEqual([]);
  });
  it('rejects citations from another thread', () => {
    const output = referenceOutput(thread.id);
    output.points[0]!.messageIds = ['ra-bearing-delay-m1'];
    expect(() => validateBrief(output, thread, dataset)).toThrow('not part of this thread');
  });
  it('rejects assignees and due dates that the cited messages do not state', () => {
    const assignee = referenceOutput(thread.id);
    assignee.points[0]!.assigneeIds = ['sam'];
    expect(() => validateBrief(assignee, thread, dataset)).toThrow('not named');
    const date = referenceOutput(thread.id);
    date.points[0]!.dueDate = '2026-10-09';
    expect(() => validateBrief(date, thread, dataset)).toThrow('not stated');
    const uncited = referenceOutput(thread.id);
    uncited.points[0]!.messageIds = ['ra-wrist-thermal-m1'];
    expect(() => validateBrief(uncited, thread, dataset)).toThrow();
  });
  it('rejects non-English text, extra fields, and too many points', () => {
    const foreign = referenceOutput(thread.id);
    foreign.points[0]!.summary = '\u99ac\u9054\u904e\u71b1';
    expect(() => validateBrief(foreign, thread, dataset)).toThrow('English');
    expect(() =>
      validateBrief({ points: [{ ...referenceOutput(thread.id).points[0], id: 'x' }] }, thread, dataset),
    ).toThrow('schema');
    const many = referenceOutput(thread.id);
    many.points = [...many.points, ...many.points, ...many.points, ...many.points];
    expect(() => validateBrief(many, thread, dataset)).toThrow('at most');
  });
  it('recognizes explicit date formats only', () => {
    expect(mentionsDate('due by Oct 2.', '2026-10-02')).toBe(true);
    expect(mentionsDate('due October 2', '2026-10-02')).toBe(true);
    expect(mentionsDate('due 2026-10-02', '2026-10-02')).toBe(true);
    expect(mentionsDate('due Oct 20', '2026-10-02')).toBe(false);
  });
});

describe('Stage 2 digest line validation', () => {
  const items = [
    { ref: 'P1', facts: 'Motor hit 92°C vs 80°C. 2026-10-02 Oct 2' },
    { ref: 'P2', facts: 'Bearing slipped.' },
  ];
  it('accepts one ordered line per item', () => {
    expect(parseDigestLines('P1 | Motor hit 92°C; fix due Oct 2.\n\nP2 | Bearing slipped.', items)).toEqual([
      'Motor hit 92°C; fix due Oct 2.',
      'Bearing slipped.',
    ]);
  });
  it('rejects missing, reordered, invented, or non-English lines', () => {
    expect(() => parseDigestLines('P1 | Motor hit 92°C.', items)).toThrow('Expected 2 lines');
    expect(() => parseDigestLines('P2 | Bearing slipped.\nP1 | Motor hot.', items)).toThrow(
      'must start with "P1',
    );
    expect(() => parseDigestLines('P1 | Motor hit 95°C.\nP2 | Bearing slipped.', items)).toThrow('"95"');
    expect(() => parseDigestLines('P1 | \u99ac\u9054\u904e\u71b1\nP2 | Bearing slipped.', items)).toThrow(
      'English',
    );
  });
});
