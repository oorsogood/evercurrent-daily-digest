import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatasetSchema, type Dataset } from '../domain/schema';
import { DigestService } from './digest/digest-service';
import { createApp } from './http/app';
import type { LlmClient } from './llm/llm';
import { SqliteRepository } from './storage/sqlite-repository';

const DATASET_PATH = 'fixtures/dataset.json';
const STATIC_DIRECTORY = 'dist';
const HOST = '127.0.0.1';

export function loadDataset(path = DATASET_PATH): Dataset {
  const dataset = DatasetSchema.parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
  const cutoff = Date.parse(dataset.cutoff);
  if (dataset.threads.some((t) => t.messages.some((m) => Date.parse(m.timestamp) > cutoff))) {
    throw new Error('Fixture messages exceed the digest cutoff.');
  }
  return dataset;
}

/**
 * Composition root: the only place that chooses concrete implementations.
 * Shared by the real entry point and the e2e server, which injects a test LLM.
 */
export function startServer(options: {
  llm: LlmClient;
  port: number;
  databasePath: string;
  dataset?: Dataset;
}) {
  const dataset = options.dataset ?? loadDataset();
  const repository = new SqliteRepository(resolve(options.databasePath));
  const service = new DigestService({ repository, llm: options.llm, dataset });
  const app = createApp(service, dataset, options.llm, resolve(STATIC_DIRECTORY));
  const server = app.listen(options.port, HOST, () => {
    const llm = options.llm.configured ? options.llm.model : 'not configured';
    console.info(`EverCurrent API: http://${HOST}:${options.port} · LLM ${llm}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      server.close();
      repository.close();
      process.exit(0);
    });
  }
  return { server, service, repository };
}
