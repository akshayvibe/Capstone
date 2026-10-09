"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LayaWireError = void 0;
exports.isLayaShapedError = isLayaShapedError;
exports.createWireClient = createWireClient;
exports.validateRoutingAnswers = validateRoutingAnswers;
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
const zod_1 = require("zod");
class LayaWireError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'LayaError';
        this.code = code;
    }
}
exports.LayaWireError = LayaWireError;
/**
 * Shape-based guard covering both the real `LayaError` and this
 * module's `LayaWireError` — `code` survives bundling/serialization,
 * class identity does not.
 */
function isLayaShapedError(e) {
    if (!(e instanceof Error) || e.name !== 'LayaError')
        return false;
    const code = e.code;
    return (typeof code === 'string' &&
        (code === 'connection' || code === 'auth' || code === 'validation' || code === 'timeout'));
}
const noulAnswerSchema = zod_1.z.object({
    type: zod_1.z.literal('noul'),
    noul: zod_1.z.number().min(0).max(1),
    confidence: zod_1.z.number(),
    action: zod_1.z.object({ act_probability: zod_1.z.number() }),
});
const scoreAnswerSchema = zod_1.z.object({
    type: zod_1.z.literal('score'),
    score: zod_1.z.number(),
    legend: zod_1.z.record(zod_1.z.string(), zod_1.z.string()),
    probabilities: zod_1.z.record(zod_1.z.string(), zod_1.z.number()),
    confidence: zod_1.z.number(),
    action: zod_1.z.object({ act_probability: zod_1.z.number() }),
});
const choiceAnswerSchema = zod_1.z.object({
    type: zod_1.z.literal('choice'),
    choice: zod_1.z.string(),
    probabilities: zod_1.z.record(zod_1.z.string(), zod_1.z.number()),
    confidence: zod_1.z.number(),
    action: zod_1.z.object({ act_probability: zod_1.z.number() }),
});
const responseSchema = zod_1.z.object({
    model: zod_1.z.string(),
    answers: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
    usage: zod_1.z.object({ input_tokens: zod_1.z.number(), output_tokens: zod_1.z.number() }),
    routing: zod_1.z.unknown().optional(),
});
const V1_SYSTEMONE = '/v1/systemone';
/** Thin `fetch` transport for `POST /v1/systemone`. Throws `LayaWireError`. */
function createWireClient(options) {
    const baseUrl = options.url;
    const timeoutMs = options.timeout ?? 3000;
    const headers = { 'content-type': 'application/json' };
    if (options.apiKey !== undefined)
        headers['authorization'] = `Bearer ${options.apiKey}`;
    return {
        async request(body) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            let response;
            try {
                response = await fetch(new URL(V1_SYSTEMONE, baseUrl), {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
            }
            catch (err) {
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
            let raw;
            try {
                raw = await response.json();
            }
            catch (err) {
                throw new LayaWireError('validation', 'Laya server response is not valid JSON', { cause: err });
            }
            const parsed = responseSchema.safeParse(raw);
            if (!parsed.success) {
                throw new LayaWireError('validation', `malformed Laya server response: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
            }
            return { model: parsed.data.model, answers: parsed.data.answers };
        },
    };
}
/**
 * Validate one system-one `answers` record against HELIX's bound question
 * set (route∈{analyze,secure,monitor}, urgency∈[0,1], complexity∈0..2).
 * Throws `LayaWireError('validation', …)` on any contract violation.
 */
function validateRoutingAnswers(answers) {
    const route = choiceAnswerSchema.safeParse(answers['route']);
    if (!route.success) {
        throw new LayaWireError('validation', `malformed answer for "route": ${route.error.issues[0]?.message ?? 'invalid'}`);
    }
    const urgency = noulAnswerSchema.safeParse(answers['urgency']);
    if (!urgency.success) {
        throw new LayaWireError('validation', `malformed answer for "urgency": ${urgency.error.issues[0]?.message ?? 'invalid'}`);
    }
    const complexity = scoreAnswerSchema.safeParse(answers['complexity']);
    if (!complexity.success) {
        throw new LayaWireError('validation', `malformed answer for "complexity": ${complexity.error.issues[0]?.message ?? 'invalid'}`);
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
