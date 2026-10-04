import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AppContext, DigestView, Job, ThreadSource } from '../../domain/contracts';
import { FiltersSchema, type Dataset, type Filters } from '../../domain/schema';
import { ServiceError } from '../digest/digest-service';

/** What the HTTP layer needs from the application. Depending on this, not on DigestService, keeps routes testable. */
export interface DigestUseCases {
  view(filters: Filters): DigestView;
  run(filters: Filters): Job;
  readonly status: Job | null;
}

export interface LlmInfo {
  configured: boolean;
  model: string;
}

const MAX_BODY_SIZE = '8kb';
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

export function createApp(service: DigestUseCases, dataset: Dataset, llm: LlmInfo, staticDirectory?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: MAX_BODY_SIZE }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  // Local prototype without authentication: reject cross-site mutations.
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'POST' && req.headers.origin) {
      let local = false;
      try {
        local = LOCAL_HOSTNAMES.includes(new URL(req.headers.origin).hostname);
      } catch {
        /* rejected below */
      }
      if (!local) {
        res.status(403).json({ error: 'Cross-site requests are not allowed.' });
        return;
      }
    }
    next();
  });
  app.get('/api/context', (_req, res) => {
    const context: AppContext = {
      date: dataset.date,
      timezone: dataset.timezone,
      cutoff: dataset.cutoff,
      threadCount: dataset.threads.length,
      users: dataset.users,
      projects: dataset.projects,
      llm: { configured: llm.configured, model: llm.model },
    };
    res.json(context);
  });
  app.post('/api/digest', (req, res) => {
    const input = z
      .strictObject({ filters: FiltersSchema, generate: z.boolean().default(false) })
      .parse(req.body ?? {});
    if (!input.generate) {
      res.json(service.view(input.filters));
      return;
    }
    res.status(202).json({ job: service.run(input.filters) });
  });
  app.get('/api/digest/status', (_req, res) => {
    res.json({ job: service.status });
  });
  app.get('/api/threads/:id', (req, res) => {
    const thread = dataset.threads.find((t) => t.id === req.params.id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found.' });
      return;
    }
    const source: ThreadSource = {
      thread,
      projectName: dataset.projects.find((p) => p.id === thread.projectId)?.name ?? thread.projectId,
    };
    res.json(source);
  });
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });
  if (staticDirectory && existsSync(resolve(staticDirectory, 'index.html'))) {
    app.use(express.static(staticDirectory));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(resolve(staticDirectory, 'index.html'));
    });
  }
  const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof ServiceError) {
      res.status(error.status).json({ error: error.message, job: error.job });
      return;
    }
    if (error instanceof z.ZodError || error instanceof RangeError) {
      res.status(400).json({ error: 'Invalid filters or request options.' });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: 'Request body must be valid JSON.' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'The server could not complete this request.' });
  };
  app.use(onError);
  return app;
}
