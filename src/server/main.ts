import { readConfig } from './config';
import { GroqClient } from './llm/groq-client';
import { startServer } from './server';

const config = readConfig();
startServer({
  llm: new GroqClient(config.GROQ_API_KEY, config.GROQ_MODEL),
  port: config.PORT,
  databasePath: config.DATABASE_PATH,
});
