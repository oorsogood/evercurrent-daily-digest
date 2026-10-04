import type { LlmClient, LlmRequest, LlmResponse } from '../../src/server/llm/llm';
import { referenceOutput } from './reference';

/**
 * Deterministic stand-in for Groq used by integration and e2e tests. It answers Stage 1 with the
 * handwritten reference briefs and Stage 2 with each item's own summary. Never used by the real server.
 */
export class TestLlm implements LlmClient {
  readonly model = 'test-llm (reference fixtures)';
  calls: LlmRequest[] = [];
  constructor(
    readonly configured = true,
    private readonly override?: (
      request: LlmRequest,
      call: number,
    ) => Promise<LlmResponse | undefined> | LlmResponse | undefined,
  ) {}
  get briefCalls() {
    return this.calls.filter((c) => c.jsonSchema).length;
  }
  get digestCalls() {
    return this.calls.filter((c) => !c.jsonSchema).length;
  }
  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    const custom = await this.override?.(request, this.calls.length);
    if (custom) return custom;
    if (request.jsonSchema) {
      const { threadId } = JSON.parse(request.user) as { threadId: string };
      return { text: JSON.stringify(referenceOutput(threadId)), tokens: 100, rate: null };
    }
    const { items } = JSON.parse(request.user) as { items: { ref: string; summary: string }[] };
    return { text: items.map((i) => `${i.ref} | ${i.summary}`).join('\n'), tokens: 50, rate: null };
  }
}
