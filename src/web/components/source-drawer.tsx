import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ThreadSource } from '../../domain/contracts';
import { api } from '../api';

export function SourceDrawer({
  threadId,
  messageIds,
  timezone,
  onClose,
}: {
  threadId: string;
  messageIds: string[];
  timezone: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<ThreadSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api
      .thread(threadId, controller.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [threadId]);
  const time = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });
  return (
    <dialog
      ref={dialog}
      className="source-drawer"
      aria-labelledby="source-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) dialog.current?.close();
      }}
    >
      <header>
        <div>
          <h2 id="source-title">Source thread</h2>
          {data && (
            <p>
              #{data.thread.channel} · {data.projectName}
            </p>
          )}
        </div>
        <button className="icon-button" aria-label="Close source" onClick={() => dialog.current?.close()}>
          <X size={18} />
        </button>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="muted">Loading thread…</p>}
      {data && (
        <ol className="messages">
          {data.thread.messages.map((m) => {
            const cited = messageIds.includes(m.id);
            return (
              <li key={m.id} className={cited ? 'cited' : undefined}>
                <div className="message-meta">
                  <strong>{m.authorName}</strong>
                  <time dateTime={m.timestamp}>{time.format(new Date(m.timestamp))}</time>
                  {cited && <span className="cited-tag">Cited</span>}
                </div>
                <p>{m.text}</p>
              </li>
            );
          })}
        </ol>
      )}
      <footer className="muted">
        Citations show where a point came from. They do not guarantee the summary is accurate.
      </footer>
    </dialog>
  );
}
