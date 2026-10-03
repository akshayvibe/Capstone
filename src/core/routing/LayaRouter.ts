/**
 * Laya-MLX routing adapter.
 *
 * Binds one typed question set against the local Laya sidecar
 * (`POST /v1/systemone`) and exposes a single `decide(prompt)`
 * entrypoint returning a strict `LayaRoutingOutcome`.
 *
 * Question set (bound once, answered in a single ~33ms forward pass):
 * - `route` (choice): analyze | secure | monitor — owns task routing.
 * - `urgency` (noul): P(request is urgent / time-sensitive).
 * - `complexity` (score low/medium/high): rubric level 0..2.
 *
 * Transport: `laya-http-client` (`createDecider`) is the primary
 * transport and is loaded lazily via dynamic `import()` — it works
 * wherever the package loads (bun, tsx/ts-node). On stock Node.js the
 * package's raw-TS entrypoint cannot be required from `node_modules`,
 * so the router falls back to the wire-compatible `fetch` transport in
 * `./layaWire.js` (same endpoint, same error codes, same validation).
 *
 * Transport failures surface as `LayaError`-shaped errors (codes
 * `connection | auth | validation | timeout`); the orchestrator treats
 * those — plus sub-threshold choice confidence — as fallback triggers.
 * This module never falls back itself: it reports, the caller decides.
 */
import type {
  AgentIntent,
  ComplexityLevel,
  LayaRoutingOutcome,
  UrgencyScore,
} from '../../types/index.js';
import { LayaUnavailableError } from '../../utils/errors.js';
import {
  createWireClient,
  isLayaShapedError,
  validateRoutingAnswers,
} from './layaWire.js';
import type { LayaTransport, ValidatedRoutingAnswers } from './layaWire.js';

/** Injectable decider for tests: mirrors the bound decider's result shape. */
export type LayaDecideFn = (state: string) => Promise<{
  model: string;
  answers: {
    route: { choice: string; confidence: number; probabilities: Record<string, number> };
    urgency: { noul: number; confidence: number };
    complexity: { score: number; confidence: number };
  };
}>;

export interface LayaRouterDeps {
  /** Sidecar base URL, e.g. `http://127.0.0.1:8000` (no `/v1/...` suffix). */
  url?: string | undefined;
  /** Per-request timeout in ms. */
  timeout?: number | undefined;
  /**
   * Pre-built transport (tests / shared clients). Any `LayaClient` from
   * `laya-http-client` satisfies this structurally (`request(body)`).
   */
  client?: LayaTransport | undefined;
  /** Pre-bound decider (tests only — skips network entirely). */
  decider?: LayaDecideFn | undefined;
}

/** Bound question set. `as const` keeps choice labels literal for inference. */
const ROUTING_QUESTIONS = {
  route: {
    type: 'choice',
    instructions: 'Which specialist agent should own this software task?',
    criteria: {
      analyze: 'code analysis, review, refactor, lint, explain, typescript, functions, bugs',
      secure: 'security audit, vulnerabilities, CVE, XSS, injection, SAST, pen test, threats',
      monitor: 'environment monitoring, health, uptime, metrics, logs, deploy, infra, docker, containers',
    },
  },
  urgency: {
    type: 'noul',
    instructions: 'Is this request urgent, time-sensitive, or blocking (outage, incident, deadline)?',
  },
  complexity: {
    type: 'score',
    instructions: 'How complex is this request to fulfil?',
    criteria: ['low', 'medium', 'high'],
  },
} as const;

const VALID_INTENTS: readonly AgentIntent[] = ['analyze', 'secure', 'monitor'];

function isAgentIntent(value: string): value is AgentIntent {
  return (VALID_INTENTS as readonly string[]).includes(value);
}

function clamp01(n: number): UrgencyScore {
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function toComplexityLevel(score: number): ComplexityLevel {
  const rounded = Math.round(score);
  if (rounded <= 0) return 0;
  if (rounded >= 2) return 2;
  return 1;
}

export class LayaRouter {
  private readonly url: string;
  private readonly timeout: number;
  private readonly injectedDecider: LayaDecideFn | undefined;
  private readonly injectedClient: LayaTransport | undefined;
  private deciderPromise: Promise<LayaDecideFn> | null = null;

  public constructor(deps: LayaRouterDeps = {}) {
    this.url = deps.url ?? process.env['LAYA_SIDECAR_URL'] ?? 'http://127.0.0.1:8000';
    this.timeout = deps.timeout ?? 3000;
    this.injectedDecider = deps.decider;
    this.injectedClient = deps.client;
  }

  /** Single decision round for one natural-language CLI request. */
  public async decide(prompt: string): Promise<LayaRoutingOutcome> {
    const decider = await this.getDecider();
    let raw: Awaited<ReturnType<LayaDecideFn>>;
    try {
      raw = await decider(prompt);
    } catch (err: unknown) {
      if (isLayaShapedError(err)) {
        throw new LayaUnavailableError(`Laya sidecar request failed (${err.code}): ${err.message}`, {
          url: this.url,
          code: err.code,
        });
      }
      throw err;
    }
    return LayaRouter.normalize(raw);
  }

  /**
   * Resolve the bound decider, preferring `laya-http-client` and degrading
   * to the vendored wire transport. Resolved once and cached.
   */
  private getDecider(): Promise<LayaDecideFn> {
    if (this.deciderPromise !== null) return this.deciderPromise;
    this.deciderPromise = (async (): Promise<LayaDecideFn> => {
      if (this.injectedDecider !== undefined) return this.injectedDecider;
      if (this.injectedClient !== undefined) {
        const client = this.injectedClient;
        return async (state: string) => ({
          model: 'injected-client',
          answers: validateRoutingAnswers(
            (await client.request({ state, questions: ROUTING_QUESTIONS })).answers,
          ),
        });
      }
      // Primary: the official typed client (loads under bun / tsx).
      try {
        const mod = await import('laya-http-client');
        const decider = mod.createDecider({
          url: this.url,
          timeout: this.timeout,
          questions: ROUTING_QUESTIONS,
        });
        return async (state: string) => {
          const res = await decider(state);
          const answers: ValidatedRoutingAnswers = {
            route: {
              choice: res.answers.route.choice,
              confidence: res.answers.route.confidence,
              probabilities: { ...res.answers.route.probabilities },
            },
            urgency: { noul: res.answers.urgency.noul, confidence: res.answers.urgency.confidence },
            complexity: { score: res.answers.complexity.score, confidence: res.answers.complexity.confidence },
          };
          return { model: res.model, answers };
        };
      } catch {
        // Stock Node.js cannot require the package's raw-TS entrypoint —
        // use the wire-compatible fetch transport instead.
        const wire = createWireClient({ url: this.url, timeout: this.timeout });
        return async (state: string) => ({
          model: 'laya-wire-fallback',
          answers: validateRoutingAnswers(
            (await wire.request({ state, questions: ROUTING_QUESTIONS })).answers,
          ),
        });
      }
    })();
    return this.deciderPromise;
  }

  /** Validate + normalize a raw decider payload into the strict outcome type. */
  private static normalize(raw: {
    model: string;
    answers: {
      route: { choice: string; confidence: number; probabilities: Record<string, number> };
      urgency: { noul: number; confidence: number };
      complexity: { score: number; confidence: number };
    };
  }): LayaRoutingOutcome {
    if (!isAgentIntent(raw.answers.route.choice)) {
      throw new LayaUnavailableError(`Laya returned an unknown route choice: "${raw.answers.route.choice}"`, {
        choice: raw.answers.route.choice,
      });
    }
    return {
      intent: raw.answers.route.choice,
      intentConfidence: raw.answers.route.confidence,
      intentProbabilities: { ...raw.answers.route.probabilities },
      urgency: clamp01(raw.answers.urgency.noul),
      urgencyConfidence: raw.answers.urgency.confidence,
      complexity: toComplexityLevel(raw.answers.complexity.score),
      complexityConfidence: raw.answers.complexity.confidence,
      model: raw.model,
    };
  }
}
