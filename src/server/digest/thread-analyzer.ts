import type { Dataset, Point, Thread } from '../../domain/schema';
import { InvalidOutputError, validateBrief } from '../../domain/validate';
import type { CallProgress, LlmCaller } from '../llm/llm-caller';
import { briefRequest } from '../llm/prompts';

const MAX_ATTEMPTS = 2;

/** Stage 1: turns one thread into validated points. One repair attempt, then the thread fails. */
export class ThreadAnalyzer {
  constructor(
    private readonly caller: LlmCaller,
    private readonly dataset: Dataset,
  ) {}

  async analyze(thread: Thread, progress: CallProgress): Promise<Point[]> {
    let repair: string | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const response = await this.caller.call(
        briefRequest(thread, this.dataset, repair),
        { kind: 'brief', target: thread.id },
        progress,
      );
      try {
        if (!response) throw new InvalidOutputError('The model output did not match the required schema.');
        return validateBrief(parseJson(response.text), thread, this.dataset);
      } catch (error) {
        if (!(error instanceof InvalidOutputError)) throw error;
        this.caller.recordInvalid('brief', thread.id, error.message);
        repair = error.message;
      }
    }
    throw new InvalidOutputError(`Thread ${thread.id} failed validation twice.`);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidOutputError('The response was not valid JSON.');
  }
}
