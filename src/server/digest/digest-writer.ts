import type { RankedPoint } from '../../domain/rank';
import type { Dataset, User } from '../../domain/schema';
import { InvalidOutputError, parseDigestLines, type WriterItem } from '../../domain/validate';
import type { CallProgress, LlmCaller } from '../llm/llm-caller';
import { digestRequest, type WriterInput } from '../llm/prompts';

const MAX_ATTEMPTS = 2;

export interface WrittenDigest {
  lines: string[];
  aiSummarized: boolean;
}

const formatDue = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Stage 2: rewrites the selected points as one sentence each for the reader.
 * It can only rephrase; order, labels, and facts are fixed by the ranking.
 */
export class DigestWriter {
  constructor(
    private readonly caller: LlmCaller,
    private readonly dataset: Dataset,
  ) {}

  async write(user: User, ranked: readonly RankedPoint[], progress: CallProgress): Promise<WrittenDigest> {
    const inputs = ranked.map((r, i): WriterInput => ({
      ref: `P${i + 1}`,
      summary: r.point.summary,
      urgency: r.urgency,
      relevance: r.relevance,
      status: r.point.status,
      dueDate: r.point.dueDate,
      assignees: r.point.assigneeIds.map((id) => this.dataset.users.find((u) => u.id === id)?.name ?? id),
    }));
    // Facts each sentence may draw numbers from.
    const checks: WriterItem[] = inputs.map((i) => ({
      ref: i.ref,
      facts: [i.summary, i.dueDate ?? '', i.dueDate ? formatDue(i.dueDate) : ''].join(' '),
    }));

    let repair: string | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const response = await this.caller.call(
        digestRequest(user, inputs, repair),
        { kind: 'digest', target: user.id },
        progress,
      );
      try {
        if (!response) throw new InvalidOutputError('The model returned an unusable response.');
        return { lines: parseDigestLines(response.text, checks), aiSummarized: true };
      } catch (error) {
        if (!(error instanceof InvalidOutputError)) throw error;
        this.caller.recordInvalid('digest', user.id, error.message);
        repair = error.message;
      }
    }
    // Honest fallback: Stage 1 summaries, labeled "Not AI-summarized" in the UI.
    return { lines: ranked.map((r) => r.point.summary), aiSummarized: false };
  }
}
