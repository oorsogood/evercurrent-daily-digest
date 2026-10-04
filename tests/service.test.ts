import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/http/app';
import { DigestService } from '../src/server/digest/digest-service';
import { LlmError, parseDuration, type LlmClient } from '../src/server/llm/llm';
import { SqliteRepository } from '../src/server/storage/sqlite-repository';
import type { Filters } from '../src/domain/schema';
import { dataset } from './support/reference';
import { MemoryRepository } from './support/memory-repository';
import { TestLlm } from './support/test-llm';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});
const alex: Filters = { userId: 'alex', projectId: 'all', relationship: null, focus: 'validation' };
const sam: Filters = { userId: 'sam', projectId: 'all', relationship: null, focus: 'supply' };
const THREADS = dataset.threads.length;

function setup(llm: LlmClient = new TestLlm(), path = ':memory:') {
  const repository = new SqliteRepository(path);
  cleanup.push(() => repository.close());
  const sleeps: number[] = [];
  const service = new DigestService({
    repository,
    llm,
    dataset,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { repository, service, sleeps, app: createApp(service, dataset, llm) };
}
async function run(service: DigestService, filters: Filters) {
  service.run(filters);
  await service.waitForIdle();
  return service.status!;
}

describe('Run Digest and cache', () => {
  it('analyzes every thread once, writes one digest, then serves it from cache with zero calls', async () => {
    const llm = new TestLlm();
    const { service } = setup(llm);
    expect(service.view(alex)).toMatchObject({
      state: 'not-generated',
      reason: 'Threads have not been analyzed yet.',
    });
    const job = await run(service, alex);
    expect(job).toMatchObject({
      state: 'succeeded',
      threadsTotal: THREADS,
      threadsDone: THREADS,
      llmCalls: THREADS + 1,
      failedThreads: [],
    });
    const before = llm.calls.length;
    const view = service.view(alex);
    expect(view.state).toBe('ready');
    expect(view.coverage).toEqual({ analyzed: THREADS, total: THREADS });
    expect(view.digest?.items[0]).toMatchObject({
      ref: 'P1',
      threadId: 'ra-wrist-thermal',
      urgency: 'high',
      relevance: 'high',
    });
    expect(view.digest?.aiSummarized).toBe(true);
    for (let i = 0; i < 20; i++) service.view(i % 2 ? alex : sam);
    expect(llm.calls.length).toBe(before);
  });
  it('needs exactly one call for new filters once threads are cached, and shares digests with identical selections', async () => {
    const llm = new TestLlm();
    const { service } = setup(llm);
    await run(service, alex);
    expect(service.view(sam).state).toBe('not-generated');
    const job = await run(service, sam);
    expect(job.llmCalls).toBe(1);
    expect(llm.briefCalls).toBe(THREADS);
    // Different filters, same selection: the cached digest answers.
    const a = service.view({
      userId: 'alex',
      projectId: 'robot-arm',
      relationship: 'owner',
      focus: 'validation',
    });
    expect(a.state).toBe('not-generated');
    await run(service, {
      userId: 'alex',
      projectId: 'robot-arm',
      relationship: 'owner',
      focus: 'validation',
    });
    expect(
      service.view({ userId: 'alex', projectId: 'robot-arm', relationship: null, focus: 'validation' }).state,
    ).toBe('ready');
  });
  it('reruns only the digest step when pressed again on cached filters', async () => {
    const llm = new TestLlm();
    const { service } = setup(llm);
    await run(service, alex);
    const job = await run(service, alex);
    expect(job.llmCalls).toBe(1);
    expect(llm.digestCalls).toBe(2);
  });
  it('waits on 429 and resumes at the same thread without re-analyzing finished threads', async () => {
    const llm = new TestLlm(true, (_r, n) => {
      if (n === 4) throw new LlmError('rate_limit', 'Groq rate limit reached.', 7000);
      return undefined;
    });
    const { service, sleeps } = setup(llm);
    const job = await run(service, alex);
    expect(job.state).toBe('succeeded');
    expect(sleeps).toContain(7000);
    expect(llm.briefCalls).toBe(THREADS + 1);
    expect(new Set(llm.calls.filter((c) => c.jsonSchema).map((c) => JSON.parse(c.user).threadId)).size).toBe(
      THREADS,
    );
  });
  it('waits proactively when the remaining token budget is too small', async () => {
    const llm = new TestLlm(true, (_r, n) =>
      n === 1
        ? {
            text: JSON.stringify({ points: [] }),
            tokens: 50,
            rate: { remainingTokens: 10, resetTokensMs: 3000, remainingRequests: 100, resetRequestsMs: 0 },
          }
        : undefined,
    );
    const { service, sleeps } = setup(llm);
    await run(service, alex);
    expect(sleeps).toContain(3000);
  });
  it('stops on a long rate-limit window, keeps finished briefs, and resumes on the next run', async () => {
    let blocked = true;
    const llm = new TestLlm(true, (_r, n) => {
      if (blocked && n === 6) throw new LlmError('rate_limit', 'Groq rate limit reached.', 3_600_000);
      return undefined;
    });
    const { service } = setup(llm);
    const failed = await run(service, alex);
    expect(failed.state).toBe('failed');
    expect(failed.error).toContain('resumes from here');
    expect(service.view(alex).coverage.analyzed).toBe(5);
    blocked = false;
    const resumed = await run(service, alex);
    expect(resumed).toMatchObject({ state: 'succeeded', threadsTotal: THREADS - 5 });
  });
  it('retries transient errors twice, then fails without caching that thread', async () => {
    const llm = new TestLlm(true, () => {
      throw new LlmError('transient', 'Groq is temporarily unavailable.');
    });
    const { service } = setup(llm);
    const job = await run(service, alex);
    expect(job.state).toBe('failed');
    expect(llm.calls.length).toBe(3);
  });
  it('stops immediately on auth and quota errors', async () => {
    for (const error of [new LlmError('auth', 'bad key'), new LlmError('quota', 'quota')]) {
      const llm = new TestLlm(true, () => {
        throw error;
      });
      const { service } = setup(llm);
      expect((await run(service, alex)).state).toBe('failed');
      expect(llm.calls.length).toBe(1);
    }
  });
  it('repairs an invalid brief once, then reports the thread as failed and uncached', async () => {
    const llm = new TestLlm(true, (r) =>
      r.jsonSchema && r.user.includes('"ra-wrist-thermal"')
        ? { text: '{"points":[{"oops":1}]}', tokens: 1, rate: null }
        : undefined,
    );
    const { service } = setup(llm);
    const job = await run(service, alex);
    expect(job).toMatchObject({ state: 'succeeded', failedThreads: ['ra-wrist-thermal'] });
    expect(llm.calls.filter((c) => c.user.includes('"ra-wrist-thermal"')).length).toBe(2);
    expect(llm.calls.filter((c) => c.user.includes('"ra-wrist-thermal"'))[1]!.system).toContain('rejected');
    expect(service.view(alex).coverage).toEqual({ analyzed: THREADS - 1, total: THREADS });
  });
  it('falls back to labeled Stage 1 summaries when the digest writer fails twice', async () => {
    const llm = new TestLlm(true, (r) =>
      r.jsonSchema ? undefined : { text: 'P1 | Invented 999 units.', tokens: 1, rate: null },
    );
    const { service } = setup(llm);
    await run(service, alex);
    const view = service.view(alex);
    expect(view.digest?.aiSummarized).toBe(false);
    expect(llm.digestCalls).toBe(2);
  });
  it('persists briefs and digests across restarts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'evercurrent-'));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'db.sqlite');
    const first = setup(new TestLlm(), path);
    await run(first.service, alex);
    first.repository.close();
    cleanup.shift();
    const llm = new TestLlm();
    const second = setup(llm, path);
    expect(second.service.view(alex).state).toBe('ready');
    expect(llm.calls.length).toBe(0);
  });
});

describe('Storage port', () => {
  it('runs the same pipeline on any DigestRepository implementation', async () => {
    const repository = new MemoryRepository();
    const llm = new TestLlm();
    const service = new DigestService({ repository, llm, dataset, sleep: async () => {} });
    service.run(alex);
    await service.waitForIdle();
    expect(service.view(alex).state).toBe('ready');
    expect(repository.briefs.size).toBe(THREADS);
    expect(repository.calls.filter((c) => c.status === 'ok')).toHaveLength(THREADS + 1);
  });
});

describe('HTTP API', () => {
  it('serves context, lookups, runs, status, and threads', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app, service } = setup(
      new TestLlm(true, async (_r, n) => {
        if (n === 1) await gate;
        return undefined;
      }),
    );
    const context = await request(app).get('/api/context');
    expect(context.body).toMatchObject({
      date: dataset.date,
      threadCount: THREADS,
      llm: { configured: true },
    });
    expect((await request(app).post('/api/digest').send({ filters: alex })).body.state).toBe('not-generated');
    const started = await request(app).post('/api/digest').send({ filters: alex, generate: true });
    expect(started.status).toBe(202);
    const busy = await request(app).post('/api/digest').send({ filters: alex, generate: true });
    expect(busy.status).toBe(409);
    expect(busy.body.job.state).toBe('running');
    release();
    await service.waitForIdle();
    expect((await request(app).get('/api/digest/status')).body.job.state).toBe('succeeded');
    expect((await request(app).post('/api/digest').send({ filters: alex })).body.state).toBe('ready');
    const thread = await request(app).get('/api/threads/ra-wrist-thermal');
    expect(thread.body).toMatchObject({ projectName: 'Robot Arm', thread: { id: 'ra-wrist-thermal' } });
    expect((await request(app).get('/api/threads/missing')).status).toBe(404);
  });
  it('returns 503 without credentials and makes no call', async () => {
    const llm = new TestLlm(false);
    const { app } = setup(llm);
    const response = await request(app).post('/api/digest').send({ filters: alex, generate: true });
    expect(response.status).toBe(503);
    expect(response.body.error).toContain('GROQ_API_KEY');
    expect(llm.calls.length).toBe(0);
  });
  it('validates input and blocks cross-site mutations', async () => {
    const { app } = setup();
    expect(
      (
        await request(app)
          .post('/api/digest')
          .send({ filters: { ...alex, userId: 'nobody' } })
      ).status,
    ).toBe(400);
    expect((await request(app).post('/api/digest').send({ filters: alex, extra: true })).status).toBe(400);
    expect(
      (await request(app).post('/api/digest').set('Origin', 'https://evil.example').send({ filters: alex }))
        .status,
    ).toBe(403);
  });
});

describe('Rate-limit header parsing', () => {
  it('parses Groq durations', () => {
    expect(parseDuration('7.66s')).toBe(7660);
    expect(parseDuration('2m59.56s')).toBe(179_560);
    expect(parseDuration('120ms')).toBe(120);
    expect(parseDuration('30')).toBe(30_000);
    expect(parseDuration(null)).toBeNull();
  });
});
