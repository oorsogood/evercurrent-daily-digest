import { useCallback, useEffect, useRef, useState } from 'react';
import { isActiveJob, type AppContext, type DigestView, type Job } from '../../domain/contracts';
import type { Filters } from '../../domain/schema';
import { api, ApiError } from '../api';

const POLL_INTERVAL_MS = 800;
const FIRST_POLL_DELAY_MS = 300;

const same = (a: Filters, b: Filters) => JSON.stringify(a) === JSON.stringify(b);

/** Filter changes only read the cache. Run Digest is the single action that can reach the LLM. */
export function useDigest() {
  const [context, setContext] = useState<AppContext | null>(null);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [view, setView] = useState<DigestView | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedFor, setGeneratedFor] = useState<{ filters: Filters; calls: number } | null>(null);
  const filtersRef = useRef<Filters | null>(null);
  filtersRef.current = filters;

  useEffect(() => {
    Promise.all([api.context(), api.status()])
      .then(([ctx, status]) => {
        setContext(ctx);
        setFilters({ userId: ctx.users[0]!.id, projectId: 'all', relationship: null, focus: 'validation' });
        if (isActiveJob(status.job)) setJob(status.job);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the workspace.'));
  }, []);

  const refresh = useCallback(async (current: Filters, signal?: AbortSignal) => {
    try {
      const next = await api.view(current, signal);
      if (filtersRef.current && same(current, filtersRef.current)) {
        setView(next);
        setError(null);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError')
        setError(e instanceof Error ? e.message : 'Could not load the digest.');
    }
  }, []);

  useEffect(() => {
    if (!filters) return;
    const controller = new AbortController();
    setView(null);
    void refresh(filters, controller.signal);
    return () => controller.abort();
  }, [filters, refresh]);

  useEffect(() => {
    if (!isActiveJob(job)) return;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const { job: next } = await api.status(controller.signal);
        setJob(next);
        if (next && !isActiveJob(next)) {
          if (next.state === 'failed') setError(next.error);
          if (next.state === 'succeeded') setGeneratedFor({ filters: next.filters, calls: next.llmCalls });
          if (filtersRef.current) await refresh(filtersRef.current);
          if (next.state === 'succeeded' && next.error) setError(next.error);
          return;
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError(e instanceof Error ? e.message : 'Lost contact with the server.');
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    timer = setTimeout(() => void poll(), FIRST_POLL_DELAY_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // Progress updates must not restart polling; only a new job does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, refresh]);

  const run = async () => {
    if (!filters || isActiveJob(job)) return;
    setError(null);
    setGeneratedFor(null);
    try {
      setJob((await api.run(filters)).job);
    } catch (e) {
      if (e instanceof ApiError && e.job) setJob(e.job);
      setError(e instanceof Error ? e.message : 'Could not start Run Digest.');
    }
  };
  const update = (next: Filters) => {
    setGeneratedFor(null);
    setError(null);
    setFilters(next);
  };
  const justGenerated = Boolean(generatedFor && view?.filters && same(generatedFor.filters, view.filters));
  return {
    context,
    filters,
    view,
    job,
    error,
    running: isActiveJob(job),
    run,
    update,
    justGenerated,
    generatedCalls: generatedFor?.calls ?? 0,
  };
}
