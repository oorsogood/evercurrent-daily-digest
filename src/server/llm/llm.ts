/** Provider-neutral LLM port. The service owns retries, waits, and validation. */
export interface RateInfo {
  remainingTokens: number | null;
  resetTokensMs: number | null;
  remainingRequests: number | null;
  resetRequestsMs: number | null;
}
export interface LlmRequest {
  system: string;
  user: string;
  /** Strict JSON-schema output when present; plain text otherwise. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxTokens: number;
}
export interface LlmResponse {
  text: string;
  tokens: number;
  rate: RateInfo | null;
}
export interface LlmClient {
  readonly model: string;
  readonly configured: boolean;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export type LlmErrorCode =
  'rate_limit' | 'quota' | 'auth' | 'transient' | 'bad_request' | 'invalid_output' | 'not_configured';
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Parses Groq reset durations such as "7.66s", "2m59.56s", "1h2m", or "120ms". */
export function parseDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const pattern = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of value.matchAll(pattern)) {
    matched = true;
    total += Number(amount) * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1000 : 1);
  }
  if (matched) return Math.ceil(total);
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : null;
}
