/** e2e server: the real app with the deterministic test LLM. Never needs an API key and never calls Groq. */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../src/server/server';
import { TestLlm } from '../support/test-llm';

const llm = new TestLlm(true, async () => {
  await new Promise((resolve) => setTimeout(resolve, 40));
  return undefined;
});
startServer({
  llm,
  port: Number(process.env.PORT ?? 3101),
  databasePath: process.env.DATABASE_PATH ?? join(tmpdir(), `evercurrent-e2e-${Date.now()}.sqlite`),
});
