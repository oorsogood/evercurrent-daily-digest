import { z } from 'zod';
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  return z
    .object({
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      DATABASE_PATH: z.string().default('.data/evercurrent.sqlite'),
      GROQ_MODEL: z.string().default('openai/gpt-oss-20b'),
      GROQ_API_KEY: z.string().optional(),
    })
    .parse(env);
}
