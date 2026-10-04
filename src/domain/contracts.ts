/**
 * Shapes exchanged over the HTTP API. Shared by the server and the web client,
 * so the client never imports server modules.
 */
import type { Filters, Level, Project, Thread, User } from './schema';

export type JobState = 'running' | 'waiting' | 'succeeded' | 'failed';
export type JobStep = 'threads' | 'digest' | 'done';

export interface Job {
  id: string;
  filters: Filters;
  state: JobState;
  step: JobStep;
  threadsTotal: number;
  threadsDone: number;
  failedThreads: string[];
  llmCalls: number;
  resumeAt: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DigestItemView {
  ref: string;
  pointId: string;
  threadId: string;
  projectId: string;
  urgency: Level;
  relevance: Level;
  resolved: boolean;
  text: string;
  messageIds: string[];
}

export interface DigestView {
  filters: Filters;
  state: 'ready' | 'empty' | 'not-generated';
  coverage: { analyzed: number; total: number };
  digest: {
    key: string;
    createdAt: string;
    model: string;
    aiSummarized: boolean;
    items: DigestItemView[];
  } | null;
  reason: string | null;
}

export interface AppContext {
  date: string;
  timezone: string;
  cutoff: string;
  threadCount: number;
  users: User[];
  projects: Project[];
  llm: { configured: boolean; model: string };
}

export interface ThreadSource {
  thread: Thread;
  projectName: string;
}

export const isActiveJob = (job: Job | null): boolean => job?.state === 'running' || job?.state === 'waiting';
