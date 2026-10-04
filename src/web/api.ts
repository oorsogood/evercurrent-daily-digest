import type { AppContext, DigestView, Job, ThreadSource } from '../domain/contracts';
import type { Filters } from '../domain/schema';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly job: Job | null = null,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError('The server is unreachable. Start it with npm run dev.', 0);
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string; job?: Job };
  if (!response.ok)
    throw new ApiError(
      body.error ?? 'The server could not complete the request.',
      response.status,
      body.job ?? null,
    );
  return body as T;
}
export const api = {
  context: () => request<AppContext>('/context'),
  view: (filters: Filters, signal?: AbortSignal) =>
    request<DigestView>('/digest', {
      method: 'POST',
      body: JSON.stringify({ filters, generate: false }),
      signal,
    }),
  run: (filters: Filters) =>
    request<{ job: Job }>('/digest', { method: 'POST', body: JSON.stringify({ filters, generate: true }) }),
  status: (signal?: AbortSignal) => request<{ job: Job | null }>('/digest/status', { signal }),
  thread: (id: string, signal?: AbortSignal) =>
    request<ThreadSource>(`/threads/${encodeURIComponent(id)}`, { signal }),
};
