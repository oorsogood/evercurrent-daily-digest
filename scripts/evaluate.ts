/**
 * Compares cached model briefs in SQLite with the handwritten reference briefs.
 * PASS/FAIL covers objective fields only; label differences that are judgment calls are listed as notes.
 *   npm run evaluate
 * Exits non-zero on any mismatch. This small synthetic set does not establish production accuracy.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ExtractedPointSchema, type Point } from '../src/domain/schema';
import { evaluateBriefs } from '../src/domain/evaluate';
import { readConfig } from '../src/server/config';
import { hashThread } from '../src/server/digest/cache-keys';
import { SqliteRepository } from '../src/server/storage/sqlite-repository';
import { loadDataset } from '../src/server/server';

let repository: SqliteRepository | undefined;
try {
  const dataset = loadDataset();
  const reference = z
    .object({ briefs: z.record(z.string(), z.array(ExtractedPointSchema)) })
    .parse(JSON.parse(readFileSync(resolve('fixtures/reference-briefs.json'), 'utf8'))).briefs;
  repository = new SqliteRepository(resolve(readConfig().DATABASE_PATH), { readOnly: true });
  const actual = new Map<string, Point[]>();
  for (const thread of dataset.threads) {
    const brief = repository.getBrief(thread.id, hashThread(thread));
    if (brief) actual.set(thread.id, brief.points);
  }
  const report = evaluateBriefs(
    reference,
    actual,
    dataset.threads.map((t) => t.id),
  );
  console.info(`Threads analyzed: ${report.analyzed}/${report.total}`);
  console.info(
    `Objective checks passed (assignees, due dates, blockers, resolved state): ${report.objectivePassed}/${report.results.length}`,
  );
  for (const r of report.results)
    if (r.failures.length) console.info(`  FAIL ${r.threadId}: ${r.failures.join('; ')}`);
  console.info(`Advisory differences (judgment calls, do not fail): ${report.advisoryCount}`);
  for (const r of report.results)
    if (r.advisories.length) console.info(`  NOTE ${r.threadId}: ${r.advisories.join('; ')}`);
  console.info(`Extra model points not in the reference: ${report.extraPoints}`);
  console.info(report.passed ? 'PASS' : 'FAIL');
  console.info(
    'Valid citations and matching fields do not prove the summaries are accurate. Read the digest against its sources.',
  );
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  repository?.close();
}
