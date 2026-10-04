import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { DatasetSchema, ExtractedPointSchema, type Point } from '../../src/domain/schema';
import { validateBrief } from '../../src/domain/validate';

export const dataset = DatasetSchema.parse(
  JSON.parse(readFileSync(resolve('fixtures/dataset.json'), 'utf8')),
);
/** Handwritten reference points: not model output. */
export const referenceBriefs = z
  .object({ briefs: z.record(z.string(), z.array(ExtractedPointSchema)) })
  .parse(JSON.parse(readFileSync(resolve('fixtures/reference-briefs.json'), 'utf8'))).briefs;
export const referenceOutput = (threadId: string) => ({
  points: structuredClone(referenceBriefs[threadId] ?? []),
});
export const referencePoints: Point[] = dataset.threads.flatMap((t) =>
  validateBrief(referenceOutput(t.id), t, dataset),
);
export const point = (threadId: string, overrides: Partial<Point> = {}): Point => {
  const found = referencePoints.find((p) => p.threadId === threadId);
  if (!found) throw new Error(`No reference point for ${threadId}`);
  return { ...found, ...overrides };
};
