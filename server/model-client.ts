import { withReadDeadline } from '../shared/deadline';

const FAILURES = {
  MODEL_TIMEOUT: { message: 'The AI request timed out before a complete response was received. Retry or ask for a shorter answer.', retryable: true },
  MODEL_CANCELLED: { message: 'The AI request was cancelled.', retryable: false },
  MODEL_AUTH: { message: 'The AI provider rejected the configured credentials or model access. Check the saved AI connection.', retryable: false },
  MODEL_RATE_LIMIT: { message: 'The AI provider usage limit was reached. Wait before retrying or review the provider quota.', retryable: true },
  MODEL_UNAVAILABLE: { message: 'The AI provider is temporarily unavailable or experiencing high demand. Try again later.', retryable: true },
  MODEL_INVALID_REQUEST: { message: 'The AI provider could not accept this request, model or input type. Check the model and reduce the context or attachments.', retryable: false },
  MODEL_EMPTY_OUTPUT: { message: 'The configured model returned no usable output. Retry or use another configured model.', retryable: true },
  MODEL_PROVIDER_ERROR: { message: 'The AI provider could not complete the request. Retry or check the saved AI connection.', retryable: true },
} as const;

export type ModelErrorCode = keyof typeof FAILURES;

/** Only fixed public messages are retained; provider errors and causes stay out of this object. */
export class ModelRequestError extends Error {
  readonly code: ModelErrorCode;
  readonly retryable: boolean;
  constructor(code: ModelErrorCode) {
    const safeCode = Object.hasOwn(FAILURES, code) ? code : 'MODEL_PROVIDER_ERROR';
    super(FAILURES[safeCode].message);
    this.name = 'ModelRequestError';
    this.code = safeCode;
    this.retryable = FAILURES[safeCode].retryable;
  }
}

const field = (value: unknown, key: string): unknown => {
  try { return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined; }
  catch { return undefined; }
};

/** Read only allowlisted status metadata, including the SDK's JSON-in-message error envelope. */
export function classifyModelError(error: unknown): ModelRequestError {
  if (error instanceof ModelRequestError) return new ModelRequestError(error.code);
  const detect = (value: unknown): ModelErrorCode | undefined => {
    const statuses = [field(value, 'status'), field(value, 'code')];
    const numeric = statuses.map(item => typeof item === 'number' ? item
      : typeof item === 'string' && /^\d{3}$/.test(item) ? Number(item) : NaN)
      .find(item => Number.isInteger(item) && item >= 400 && item <= 599);
    if (numeric === 401 || numeric === 403) return 'MODEL_AUTH';
    if (numeric === 429) return 'MODEL_RATE_LIMIT';
    if (numeric === 408 || numeric === 504) return 'MODEL_TIMEOUT';
    if (numeric !== undefined) return numeric >= 500 ? 'MODEL_UNAVAILABLE' : 'MODEL_INVALID_REQUEST';
    const symbolic: Record<string, ModelErrorCode> = {
      UNAUTHENTICATED: 'MODEL_AUTH', PERMISSION_DENIED: 'MODEL_AUTH', RESOURCE_EXHAUSTED: 'MODEL_RATE_LIMIT',
      DEADLINE_EXCEEDED: 'MODEL_TIMEOUT', ETIMEDOUT: 'MODEL_TIMEOUT', UND_ERR_CONNECT_TIMEOUT: 'MODEL_TIMEOUT',
      UNAVAILABLE: 'MODEL_UNAVAILABLE', INTERNAL: 'MODEL_UNAVAILABLE', UNKNOWN: 'MODEL_UNAVAILABLE',
      ECONNRESET: 'MODEL_UNAVAILABLE', ECONNREFUSED: 'MODEL_UNAVAILABLE', ENOTFOUND: 'MODEL_UNAVAILABLE',
      EAI_AGAIN: 'MODEL_UNAVAILABLE', EHOSTUNREACH: 'MODEL_UNAVAILABLE', ENETUNREACH: 'MODEL_UNAVAILABLE',
      INVALID_ARGUMENT: 'MODEL_INVALID_REQUEST', NOT_FOUND: 'MODEL_INVALID_REQUEST', FAILED_PRECONDITION: 'MODEL_INVALID_REQUEST',
      OUT_OF_RANGE: 'MODEL_INVALID_REQUEST', UNIMPLEMENTED: 'MODEL_INVALID_REQUEST',
    };
    for (const status of statuses) if (typeof status === 'string' && Object.hasOwn(symbolic, status)) return symbolic[status];
  };
  // Prefer the actual outer response over a different status buried in its cause/body.
  const cause = field(error, 'cause');
  for (const source of [error, field(error, 'error'), cause, field(cause, 'error')]) {
    const code = detect(source); if (code) return new ModelRequestError(code);
  }
  const message = field(error, 'message');
  if (typeof message === 'string' && message.length <= 16_384) {
    const first = message.indexOf('{'), last = message.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        const parsed = JSON.parse(message.slice(first, last + 1));
        const code = detect(parsed) ?? detect(field(parsed, 'error'));
        if (code) return new ModelRequestError(code);
      } catch { /* Non-JSON messages are never echoed or guessed. */ }
    }
  }
  if (field(error, 'name') === 'TimeoutError') return new ModelRequestError('MODEL_TIMEOUT');
  return new ModelRequestError('MODEL_PROVIDER_ERROR');
}

export async function generateWithBoundedFallback(
  ai: { models: { generateContent: (input: any) => Promise<{ text?: string }> } },
  requestedModel: string, fallbackModel: string | string[],
  contents: any[], temperature: number, timeoutMs = 90_000, externalSignal?: AbortSignal,
) {
  const models = [...new Set([requestedModel, ...(Array.isArray(fallbackModel) ? fallbackModel : [fallbackModel])].map(model => model.trim()).filter(Boolean))];
  if (!models.length) throw new ModelRequestError('MODEL_INVALID_REQUEST');
  if (externalSignal?.aborted) throw new ModelRequestError('MODEL_CANCELLED');
  const budget = Number.isFinite(timeoutMs) ? Math.max(100, timeoutMs) : 90_000;
  const deadline = Date.now() + budget;
  try {
    return await withReadDeadline(async totalSignal => {
      let failure = new ModelRequestError('MODEL_PROVIDER_ERROR');
      for (const [index, model] of models.entries()) {
        if (externalSignal?.aborted) throw new ModelRequestError('MODEL_CANCELLED');
        if (totalSignal.aborted) throw new ModelRequestError('MODEL_TIMEOUT');
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new ModelRequestError('MODEL_TIMEOUT');
        // A sole model receives the full budget. Reserve a third for distinct
        // configured fallbacks; unused time remains available after early errors.
        const attemptsLeft = models.length - index;
        const attemptBudget = attemptsLeft === 1 ? remaining : index === 0 ? remaining * 2 / 3 : remaining / attemptsLeft;
        try {
          const response = await withReadDeadline(signal => ai.models.generateContent({ model, contents, config: { temperature, abortSignal: signal } }),
            attemptBudget, FAILURES.MODEL_TIMEOUT.message, { signal: totalSignal });
          if (externalSignal?.aborted) throw new ModelRequestError('MODEL_CANCELLED');
          if (totalSignal.aborted) throw new ModelRequestError('MODEL_TIMEOUT');
          if (!response.text?.trim()) throw new ModelRequestError('MODEL_EMPTY_OUTPUT');
          return { text: response.text, modelUsed: model, fallback: model !== models[0],
            warning: model !== models[0] ? `Model ${models[0]} did not answer; configured fallback ${model} was used.` : undefined };
        } catch (error) {
          if (externalSignal?.aborted) throw new ModelRequestError('MODEL_CANCELLED');
          if (totalSignal.aborted) throw new ModelRequestError('MODEL_TIMEOUT');
          failure = classifyModelError(error);
        }
      }
      throw failure;
    }, budget, FAILURES.MODEL_TIMEOUT.message, { signal: externalSignal });
  } catch (error) {
    if (externalSignal?.aborted) throw new ModelRequestError('MODEL_CANCELLED');
    throw classifyModelError(error);
  }
}
