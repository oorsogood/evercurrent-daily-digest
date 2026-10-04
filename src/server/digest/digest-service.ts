import { randomUUID } from 'node:crypto';
import { isActiveJob, type DigestView, type Job } from '../../domain/contracts';
import { normalizeFilters, selectPoints } from '../../domain/rank';
import type { Dataset, Filters, Thread } from '../../domain/schema';
import { InvalidOutputError } from '../../domain/validate';
import { LlmError, type LlmClient } from '../llm/llm';
import { DEFAULT_CALL_LIMITS, LlmCaller, type CallLimits, type CallProgress } from '../llm/llm-caller';
import type { DigestRepository } from '../storage/ports';
import { digestKey, hashThreads } from './cache-keys';
import { DigestQuery } from './digest-query';
import { DigestWriter } from './digest-writer';
import { ThreadAnalyzer } from './thread-analyzer';

export class ServiceError extends Error {
  constructor(
    readonly status: 409 | 503,
    message: string,
    readonly job: Job | null = null,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface DigestServiceDependencies {
  repository: DigestRepository;
  llm: LlmClient;
  dataset: Dataset;
  sleep?: (ms: number) => Promise<void>;
  limits?: CallLimits;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Coordinates Run Digest, the only path that reaches the LLM, and tracks one job at a time.
 * The work itself is delegated: ThreadAnalyzer (Stage 1), selectPoints (ranking),
 * DigestWriter (Stage 2), and DigestQuery (cache reads).
 */
export class DigestService {
  private job: Job | null = null;
  private pending: Promise<void> = Promise.resolve();
  private readonly caller: LlmCaller;
  private readonly analyzer: ThreadAnalyzer;
  private readonly writer: DigestWriter;
  private readonly query: DigestQuery;
  private readonly threadHashes: ReadonlyMap<string, string>;

  constructor(private readonly deps: DigestServiceDependencies) {
    this.threadHashes = hashThreads(deps.dataset);
    this.caller = new LlmCaller(
      deps.llm,
      deps.repository,
      deps.sleep ?? defaultSleep,
      deps.limits ?? DEFAULT_CALL_LIMITS,
    );
    this.analyzer = new ThreadAnalyzer(this.caller, deps.dataset);
    this.writer = new DigestWriter(this.caller, deps.dataset);
    this.query = new DigestQuery(deps.repository, deps.dataset, this.threadHashes);
  }

  get status(): Job | null {
    return this.job ? structuredClone(this.job) : null;
  }

  async waitForIdle(): Promise<void> {
    await this.pending;
  }

  /** Cache lookup only. Zero LLM calls. */
  view(filters: Filters): DigestView {
    return this.query.view(filters);
  }

  /** Run Digest: analyze uncached threads, then (re)write the digest for these filters. */
  run(rawFilters: Filters): Job {
    const filters = normalizeFilters(this.deps.dataset, rawFilters);
    if (isActiveJob(this.job)) {
      throw new ServiceError(409, 'A digest run is already in progress.', this.status);
    }
    if (!this.caller.configured) {
      throw new ServiceError(
        503,
        'Live analysis is not configured. Add GROQ_API_KEY to .env and restart the server.',
      );
    }
    const job = newJob(filters);
    this.job = job;
    this.caller.startRun();
    this.pending = new Promise<void>((resolve) => setImmediate(resolve)).then(() => this.execute(job));
    return this.status!;
  }

  private async execute(job: Job): Promise<void> {
    const progress = progressFor(job);
    try {
      await this.analyzePendingThreads(job, progress);
      job.step = 'digest';
      await this.writeDigest(job, progress);
      job.step = 'done';
      job.state = 'succeeded';
      if (job.failedThreads.length) {
        job.error = `${job.failedThreads.length} thread(s) could not be analyzed and will be retried next run.`;
      }
    } catch (error) {
      job.state = 'failed';
      job.error = failureMessage(error);
      if (!(error instanceof LlmError)) console.error(error);
    } finally {
      job.resumeAt = null;
      job.finishedAt = new Date().toISOString();
    }
  }

  private async analyzePendingThreads(job: Job, progress: CallProgress): Promise<void> {
    const pending = this.deps.dataset.threads.filter(
      (t) => !this.deps.repository.getBrief(t.id, this.hashOf(t)),
    );
    job.threadsTotal = pending.length;
    for (const thread of pending) {
      try {
        const points = await this.analyzer.analyze(thread, progress);
        this.deps.repository.saveBrief({
          threadId: thread.id,
          contentHash: this.hashOf(thread),
          points,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        // An invalid thread is reported and retried next run; provider errors stop the run.
        if (!(error instanceof InvalidOutputError)) throw error;
        job.failedThreads.push(thread.id);
      }
      job.threadsDone++;
    }
  }

  private async writeDigest(job: Job, progress: CallProgress): Promise<void> {
    const { dataset, repository } = this.deps;
    const ranked = selectPoints(this.query.cachedPoints().points, dataset, job.filters);
    if (!ranked.length) return;
    const user = dataset.users.find((u) => u.id === job.filters.userId)!;
    const { lines, aiSummarized } = await this.writer.write(user, ranked, progress);
    repository.saveDigest({
      key: digestKey(user.id, ranked, this.threadHashes),
      userId: user.id,
      filters: job.filters,
      items: ranked.map((r, i) => ({ pointId: r.point.id, text: lines[i]! })),
      aiSummarized,
      model: this.caller.model,
      createdAt: new Date().toISOString(),
    });
  }

  private hashOf(thread: Thread): string {
    return this.threadHashes.get(thread.id)!;
  }
}

function newJob(filters: Filters): Job {
  return {
    id: randomUUID(),
    filters,
    state: 'running',
    step: 'threads',
    threadsTotal: 0,
    threadsDone: 0,
    failedThreads: [],
    llmCalls: 0,
    resumeAt: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

/** Translates LLM caller events into job state the UI polls. */
function progressFor(job: Job): CallProgress {
  return {
    onAttempt: () => {
      job.llmCalls++;
    },
    onWait: (resumeAt) => {
      job.state = 'waiting';
      job.resumeAt = resumeAt;
    },
    onResume: () => {
      job.state = 'running';
      job.resumeAt = null;
    },
  };
}

function failureMessage(error: unknown): string {
  if (!(error instanceof LlmError)) {
    return 'The run could not be completed. Check the server log and storage, then retry.';
  }
  const resumable = error.code === 'rate_limit' || error.code === 'quota';
  return resumable
    ? `${error.message} Completed threads are cached; Run Digest resumes from here.`
    : error.message;
}
