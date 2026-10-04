import type { CallKind, CallLogStore } from '../storage/ports';
import { LlmError, type LlmClient, type LlmRequest, type LlmResponse, type RateInfo } from './llm';

export interface CallLimits {
  /** Longest single wait for a rate-limit window before giving up. */
  maxWaitMs: number;
  /** Rate-limit waits allowed per run. */
  maxWaits: number;
  /** Retries for timeouts and 5xx responses. */
  transientRetries: number;
  /** Multiplier on the largest observed usage when budgeting the next request. */
  budgetHeadroom: number;
  /** First transient backoff; doubles on each retry. */
  backoffBaseMs: number;
}

export const DEFAULT_CALL_LIMITS: CallLimits = {
  maxWaitMs: 120_000,
  maxWaits: 5,
  transientRetries: 2,
  budgetHeadroom: 1.2,
  backoffBaseMs: 1000,
};

/** Hooks that let the caller report progress without knowing about jobs. */
export interface CallProgress {
  onAttempt(): void;
  onWait(resumeAt: string): void;
  onResume(): void;
}

export interface CallTarget {
  kind: CallKind;
  target: string;
}

/**
 * Single owner of how requests reach the LLM: rate-limit budgeting, waits, bounded retries,
 * and the call log. Returns null when the provider reports invalid output, so the caller can repair.
 */
export class LlmCaller {
  private rate: RateInfo | null = null;
  private readonly observed = new Map<CallKind, number>();
  private waits = 0;

  constructor(
    private readonly llm: LlmClient,
    private readonly log: CallLogStore,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly limits: CallLimits = DEFAULT_CALL_LIMITS,
  ) {}

  get model(): string {
    return this.llm.model;
  }

  get configured(): boolean {
    return this.llm.configured;
  }

  /** Resets the per-run wait budget. Observed usage is kept, because it remains a good estimate. */
  startRun(): void {
    this.waits = 0;
  }

  async call(
    request: LlmRequest,
    { kind, target }: CallTarget,
    progress: CallProgress,
  ): Promise<LlmResponse | null> {
    for (let transient = 0; ;) {
      await this.respectRateLimit(request, kind, progress);
      const started = Date.now();
      try {
        progress.onAttempt();
        const response = await this.llm.complete(request);
        this.rate = response.rate;
        if (response.tokens > 0) {
          this.observed.set(kind, Math.max(this.observed.get(kind) ?? 0, response.tokens));
        }
        this.record(kind, target, 'ok', response.tokens, Date.now() - started, null);
        return response;
      } catch (error) {
        const failure =
          error instanceof LlmError ? error : new LlmError('transient', 'Unexpected provider failure.');
        this.record(kind, target, 'error', 0, Date.now() - started, `${failure.code}: ${failure.message}`);
        if (failure.code === 'invalid_output') return null;
        if (failure.code === 'rate_limit') {
          if (failure.retryAfterMs > this.limits.maxWaitMs || this.waits >= this.limits.maxWaits) {
            const seconds = Math.ceil(failure.retryAfterMs / 1000);
            throw new LlmError(
              'rate_limit',
              `Groq rate limit reached; the next window opens in about ${seconds}s.`,
            );
          }
          await this.wait(failure.retryAfterMs, progress);
          continue;
        }
        if (failure.code === 'transient' && transient < this.limits.transientRetries) {
          await this.sleep(this.limits.backoffBaseMs * 2 ** transient);
          transient++;
          continue;
        }
        throw failure;
      }
    }
  }

  /** Records a response that arrived but failed validation, so the log shows every attempt. */
  recordInvalid(kind: CallKind, target: string, message: string): void {
    this.record(kind, target, 'invalid', 0, 0, message);
  }

  private async respectRateLimit(request: LlmRequest, kind: CallKind, progress: CallProgress): Promise<void> {
    const rate = this.rate;
    if (!rate) return;
    // Budget from real usage when known; before the first response, use a conservative estimate.
    const seen = this.observed.get(kind);
    const needed = seen
      ? Math.ceil(seen * this.limits.budgetHeadroom)
      : request.maxTokens + Math.ceil((request.system.length + request.user.length) / 3);
    let waitMs = 0;
    if (rate.remainingRequests !== null && rate.remainingRequests < 1) {
      waitMs = rate.resetRequestsMs ?? 0;
    }
    if (rate.remainingTokens !== null && rate.remainingTokens < needed) {
      waitMs = Math.max(waitMs, rate.resetTokensMs ?? 0);
    }
    if (waitMs <= 0) return;
    if (waitMs > this.limits.maxWaitMs) {
      const seconds = Math.ceil(waitMs / 1000);
      throw new LlmError(
        'rate_limit',
        `Groq token budget is exhausted; the next window opens in about ${seconds}s.`,
      );
    }
    this.rate = null;
    await this.wait(waitMs, progress);
  }

  private async wait(ms: number, progress: CallProgress): Promise<void> {
    this.waits++;
    progress.onWait(new Date(Date.now() + ms).toISOString());
    await this.sleep(ms);
    progress.onResume();
  }

  private record(
    kind: CallKind,
    target: string,
    status: 'ok' | 'error' | 'invalid',
    tokens: number,
    latencyMs: number,
    error: string | null,
  ): void {
    this.log.logCall({ kind, target, model: this.llm.model, status, tokens, latencyMs, error });
  }
}
