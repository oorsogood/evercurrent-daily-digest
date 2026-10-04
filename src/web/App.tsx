import { useEffect, useState } from 'react';
import { useDigest } from './hooks/use-digest';
import { FilterBar } from './components/filter-bar';
import { DigestList, type DigestItem } from './components/digest-list';
import { SourceDrawer } from './components/source-drawer';
import type { Job } from '../domain/contracts';

function useNow(enabled: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}
function progress(job: Job, now: number): string {
  if (job.state === 'waiting' && job.resumeAt)
    return `Waiting for rate limit · resumes in ${Math.max(0, Math.ceil((Date.parse(job.resumeAt) - now) / 1000))}s`;
  if (job.step === 'threads') return `Analyzing threads ${job.threadsDone}/${job.threadsTotal}`;
  return 'Writing digest';
}

export default function App() {
  const digest = useDigest();
  const [source, setSource] = useState<DigestItem | null>(null);
  const { context, filters, view, job, error, running } = digest;
  const now = useNow(job?.state === 'waiting');
  if (!context || !filters)
    return (
      <main className="page">
        <h1>EverCurrent Daily Digest</h1>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </main>
    );

  const user = context.users.find((u) => u.id === filters.userId)!;
  const asOf = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: context.timezone,
    timeZoneName: 'short',
  }).format(new Date(context.cutoff));
  let status: string;
  if (running && job) status = progress(job, now);
  else if (!view) status = 'Loading…';
  else if (view.state === 'ready')
    status = digest.justGenerated
      ? `Generated · ${digest.generatedCalls} LLM call${digest.generatedCalls === 1 ? '' : 's'}`
      : 'Cached · 0 LLM calls';
  else if (view.state === 'empty') status = 'No LLM call needed';
  else status = 'Not generated for these filters';

  return (
    <main className="page">
      <header className="page-header">
        <h1>EverCurrent Daily Digest</h1>
        <span className="muted">{asOf}</span>
      </header>
      <FilterBar
        context={context}
        filters={filters}
        onChange={digest.update}
        onRun={() => void digest.run()}
        running={running}
      />
      <p className="status" role="status" aria-live="polite">
        {status}
        {!context.llm.configured && !running && view?.state === 'not-generated'
          ? ' · Add GROQ_API_KEY to .env to run'
          : ''}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="digest" aria-labelledby="digest-title">
        <h2 id="digest-title">{user.name.split(' ')[0]}’s key points</h2>
        {view?.state === 'ready' && <DigestList view={view} onSource={setSource} />}
        {view?.state === 'empty' && <p className="muted">Nothing needs your attention for these filters.</p>}
        {view?.state === 'not-generated' && (
          <p className="muted">
            {view.reason ?? 'This digest has not been generated yet.'} Press Run Digest to generate it.
          </p>
        )}
        {view && view.coverage.analyzed > 0 && view.coverage.analyzed < view.coverage.total && (
          <p className="warning">
            Analyzed {view.coverage.analyzed}/{view.coverage.total} threads. Run Digest retries the rest.
          </p>
        )}
        {view?.digest && (
          <p className="meta">
            {view.digest.aiSummarized
              ? ''
              : 'Not AI-summarized: showing thread summaries because the digest writer failed validation. · '}
            {view.digest.model} · generated{' '}
            {new Date(view.digest.createdAt).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        )}
      </section>
      {source && (
        <SourceDrawer
          threadId={source.threadId}
          messageIds={source.messageIds}
          timezone={context.timezone}
          onClose={() => setSource(null)}
        />
      )}
    </main>
  );
}
