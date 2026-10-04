import Groq from 'groq-sdk';
import {
  LlmError,
  parseDuration,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  type RateInfo,
} from './llm';

const REQUEST_TIMEOUT_MS = 60_000;
const TEMPERATURE = 0.2;
const DEFAULT_RETRY_AFTER_MS = 10_000;

const toNumber = (value: string | null) =>
  value === null || value === '' || Number.isNaN(Number(value)) ? null : Number(value);
function readRate(headers: Headers | undefined): RateInfo | null {
  if (!headers) return null;
  return {
    remainingTokens: toNumber(headers.get('x-ratelimit-remaining-tokens')),
    resetTokensMs: parseDuration(headers.get('x-ratelimit-reset-tokens')),
    remainingRequests: toNumber(headers.get('x-ratelimit-remaining-requests')),
    resetRequestsMs: parseDuration(headers.get('x-ratelimit-reset-requests')),
  };
}

/** Official Groq SDK adapter. SDK retries are disabled so LlmCaller is the single owner of retry policy. */
export class GroqClient implements LlmClient {
  readonly configured: boolean;
  private readonly client: Groq | null;
  constructor(
    apiKey: string | undefined,
    readonly model: string,
  ) {
    this.configured = Boolean(apiKey?.trim());
    this.client = this.configured ? new Groq({ apiKey, maxRetries: 0, timeout: REQUEST_TIMEOUT_MS }) : null;
  }
  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (!this.client)
      throw new LlmError('not_configured', 'Set GROQ_API_KEY in .env and restart the server.');
    const reasoning = /gpt-oss/.test(this.model)
      ? { reasoning_effort: 'low' as const, include_reasoning: false }
      : {};
    try {
      const { data, response } = await this.client.chat.completions
        .create({
          model: this.model,
          temperature: TEMPERATURE,
          max_completion_tokens: request.maxTokens,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          ...(request.jsonSchema
            ? {
                response_format: {
                  type: 'json_schema' as const,
                  json_schema: {
                    name: request.jsonSchema.name,
                    strict: true,
                    schema: request.jsonSchema.schema,
                  },
                },
              }
            : {}),
          ...reasoning,
        })
        .withResponse();
      const choice = data.choices[0];
      if (!choice?.message.content)
        throw new LlmError('invalid_output', 'The model returned an empty response.');
      if (choice.finish_reason !== 'stop')
        throw new LlmError('invalid_output', 'The model response was cut off.');
      return {
        text: choice.message.content,
        tokens: data.usage?.total_tokens ?? 0,
        rate: readRate(response.headers),
      };
    } catch (error) {
      if (error instanceof LlmError) throw error;
      if (error instanceof Groq.APIError) throw mapApiError(error);
      throw new LlmError('transient', 'Could not reach Groq. Check the connection and try again.');
    }
  }
}

function mapApiError(error: InstanceType<typeof Groq.APIError>): LlmError {
  const status = error.status;
  const body = (error.error ?? {}) as {
    error?: { code?: string; message?: string };
    code?: string;
    message?: string;
  };
  const code = String(body.error?.code ?? body.code ?? '');
  const message = String(body.error?.message ?? body.message ?? error.message ?? '');
  if (status === 401 || status === 403)
    return new LlmError('auth', 'Groq rejected the API key or model access. Check the server configuration.');
  if (status === 429) {
    if (/quota|billing|insufficient/i.test(`${code} ${message}`))
      return new LlmError('quota', 'The Groq quota is exhausted. Cached results remain available.');
    const retryAfter =
      parseDuration(error.headers?.get('retry-after')) ??
      parseDuration(error.headers?.get('x-ratelimit-reset-tokens')) ??
      DEFAULT_RETRY_AFTER_MS;
    return new LlmError('rate_limit', 'Groq rate limit reached.', retryAfter);
  }
  // Strict JSON mode reports schema failures as 400 json_validate_failed: that is a model output problem.
  if (status === 400 && /json_validate_failed/.test(code))
    return new LlmError('invalid_output', 'The model output did not match the required schema.');
  if (status && status < 500)
    return new LlmError(
      'bad_request',
      `Groq rejected the request (${status}). Check the model name and request format.`,
    );
  return new LlmError('transient', 'Groq is temporarily unavailable.');
}
