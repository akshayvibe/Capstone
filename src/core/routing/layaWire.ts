/**
 * Minimal wire-compatible transport for the Laya `POST /v1/systemone`
 * protocol.
 *
 * Why this exists: `laya-http-client` is the primary transport (used
 * whenever it loads — e.g. under bun/tsx), but the package publishes
 * raw TypeScript (`"main": "src/index.ts"`), which plain Node.js
 * refuses to load from `node_modules` (type-stripping is unsupported
 * there). This module speaks the same wire protocol with `fetch` + `zod`
 * so `LayaRouter` works on stock Node with identical semantics:
 * same endpoint, same error codes, same per-question validation.
 *
 * Error shape mirrors `LayaError` (`name === 'LayaError'` plus a `code`
 * of `connection | auth | validation | timeout`) so callers narrow both
 * implementations with `isLayaShapedError`.
 */
import { z } from 'zod';

export type LayaWireErrorCode = 'connection' | 'auth' | 'validation' | 'timeout';

export class LayaWireError extends Error {
  public readonly code: LayaWireErrorCode;

  public constructor(code: LayaWireErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LayaError';
    this.code = code;
  }
}

/**
 * Shape-based guard covering both the real `LayaError` and this
 * module's `LayaWireError` — `code` survives bundling/serialization,
 * class identity does not.
 */
export function isLayaShapedError(e: unknown): e is Error & { code: LayaWireErrorCode } {
  if (!(e instanceof Error) || e.name !== 'LayaError') return false;
  const code = (e as unknown as { code?: unknown }).code;
  return (
    typeof code === 'string' &&
    (code === 'connection' || code === 'auth' || code === 'validation' || code === 'timeout')
  );
}

/** Structural transport: satisfied by `LayaClient` and the wire client below. */
export interface LayaTransport {
  request(body: unknown): Promise<{ model: string; answers: Record<string, unknown> }>;
}

const noulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number().min(0).max(1),
  confidence: z.number(),
  action: z.object({ act_probability: z.number() }),
});

const scoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number(),
  legend: z.record(z.string(), z.string()),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
  action: z.object({ act_probability: z.number() }),
});

const choiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
  action: z.object({ act_probability: z.number() }),
});

const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.unknown()),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
  routing: z.unknown().optional(),
});

export interface WireClientOptions {
  url: string;
  timeout?: number | undefined;
  apiKey?: string | undefined;
}

const V1_SYSTEMONE = '/v1/systemone';

/** Thin `fetch` transport for `POST /v1/systemone`. Throws `LayaWireError`. */
export function createWireClient(options: WireClientOptions): LayaTransport {
  const baseUrl = options.url;
  const timeoutMs = options.timeout ?? 3000;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.apiKey !== undefined) headers['authorization'] = `Bearer ${options.apiKey}`;

  return {
    async request(body: unknown): Promise<{ model: string; answers: Record<string, unknown> }> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(new URL(V1_SYSTEMONE, baseUrl), {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err: unknown) {
        clearTimeout(timer);
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new LayaWireError('timeout', `request timed out after ${timeoutMs}ms`);
        }
        throw new LayaWireError('connection', `could not reach Laya server at ${baseUrl}`, { cause: err });
      }
      clearTimeout(timer);

      if (response.status === 401 || response.status === 403) {
        throw new LayaWireError('auth', `Laya server rejected credentials (HTTP ${response.status})`);
      }
      if (response.status === 422) {
        throw new LayaWireError('validation', 'Laya server rejected the request (HTTP 422)');
      }
      if (!response.ok) {
        throw new LayaWireError('connection', `Laya server returned HTTP ${response.status}`);
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch (err: unknown) {
        throw new LayaWireError('validation', 'Laya server response is not valid JSON', { cause: err });
      }
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new LayaWireError(
          'validation',
          `malformed Laya server response: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
        );
      }
      return { model: parsed.data.model, answers: parsed.data.answers };
    },
  };
}

export interface ValidatedRoutingAnswers {
  route: { choice: string; confidence: number; probabilities: Record<string, number> };
  urgency: { noul: number; confidence: number };
  complexity: { score: number; confidence: number };
}

/**
 * Validate one system-one `answers` record against HELIX's bound question
 * set (route∈{analyze,secure,monitor}, urgency∈[0,1], complexity∈0..2).
 * Throws `LayaWireError('validation', …)` on any contract violation.
 */
export function validateRoutingAnswers(answers: Record<string, unknown>): ValidatedRoutingAnswers {
  const route = choiceAnswerSchema.safeParse(answers['route']);
  if (!route.success) {
    throw new LayaWireError('validation', `malformed answer for "route": ${route.error.issues[0]?.message ?? 'invalid'}`);
  }
  const urgency = noulAnswerSchema.safeParse(answers['urgency']);
  if (!urgency.success) {
    throw new LayaWireError(
      'validation',
      `malformed answer for "urgency": ${urgency.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  const complexity = scoreAnswerSchema.safeParse(answers['complexity']);
  if (!complexity.success) {
    throw new LayaWireError(
      'validation',
      `malformed answer for "complexity": ${complexity.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  if (complexity.data.score < 0 || complexity.data.score > 2) {
    throw new LayaWireError('validation', 'malformed answer for "complexity": score outside rubric levels 0..2');
  }
  return {
    route: { choice: route.data.choice, confidence: route.data.confidence, probabilities: { ...route.data.probabilities } },
    urgency: { noul: urgency.data.noul, confidence: urgency.data.confidence },
    complexity: { score: complexity.data.score, confidence: complexity.data.confidence },
  };
}
