import type winston from 'winston';
import type { AgentIntent, AgentPayload, AgentResult, CliResponse, RoutingDecision } from '../../types/index.js';
import type { IAgent } from '../agents/agents.js';
import { CodeAgent, EnvironmentAgent, SecurityAgent } from '../agents/agents.js';
import { AgentExecutionError } from '../../utils/errors.js';
import type { IOrchestratorAgent } from './IOrchestratorAgent.js';

export interface OrchestratorDeps {
  logger: winston.Logger;
  /** Injectable registry — swap / extend without touching routing logic (O/CP). */
  agents?: IAgent[];
}

/**
 * Race a promise against a timeout. Extracted for testability.
 * Note: this does not cancel the underlying agent work — a timed-out
 * agent keeps running in the background, its late settlement ignored.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, agent: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AgentExecutionError(agent, `timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Default orchestrator: typed routing + fan-out delegation.
 *
 * Responsibilities (SRP):
 *  1. `route()` — pure decision step (future: laya-mlx call site).
 *  2. `dispatch()` — execute selected agents, aggregate results.
 *
 * The laya-mlx integration should replace the body of `route()`
 * while keeping its `Promise<RoutingDecision>` signature stable.
 */
export class OrchestratorAgent implements IOrchestratorAgent {
  private readonly logger: winston.Logger;
  private readonly registry: Map<AgentIntent, IAgent>;

  public constructor(deps: OrchestratorDeps) {
    this.logger = deps.logger;
    const agents: IAgent[] = deps.agents ?? [new CodeAgent(), new SecurityAgent(), new EnvironmentAgent()];
    this.registry = new Map(agents.map((a) => [a.intent, a]));
  }

  public listAgents(): string[] {
    return [...this.registry.values()].map((a) => `${a.name} (${a.intent})`);
  }

  /**
   * Typed decision routing.
   *
   * TODO(laya-mlx): replace heuristic with e.g.
   *   `const decision = await layaMlx.route<RoutingDecision>(payload.prompt, { intents: [...] })`
   * and validate the result against the `RoutingDecision` interface.
   */
  public async route(payload: AgentPayload): Promise<RoutingDecision> {
    // Explicit flag intents always win — deterministic and testable.
    if (payload.intents.length > 0) {
      return {
        intents: [...payload.intents],
        confidence: 1.0,
        reason: 'explicit CLI flags',
      };
    }

    const text = payload.prompt.toLowerCase();
    const intents = new Set<AgentIntent>();
    // Word boundaries prevent substring false positives:
    // "login"/"catalog" must not trigger monitor via "log",
    // "decode" must not trigger analyze via "code".
    if (/\b(secur\w*|vuln\w*|cve|xss|sast|injection|pen-?\s?test|threat|audit)\b/.test(text)) intents.add('secure');
    if (/\b(monitor\w*|health\w*|uptime|metrics?|logs?|deploy\w*|infra\w*|environments?)\b/.test(text))
      intents.add('monitor');
    if (/\b(analy[sz]e|review\w*|refactor\w*|lint\w*|explain|code|typescript|function|bugs?)\b/.test(text))
      intents.add('analyze');
    if (intents.size === 0) intents.add('analyze'); // safe default for bootstrap

    const decided = [...intents];
    this.logger.debug('Routing decision (heuristic; laya-mlx pending)', {
      traceId: payload.traceId,
      intents: decided,
    });
    return { intents: decided, confidence: 0.5, reason: 'keyword heuristic (laya-mlx not yet wired)' };
  }

  public async dispatch(payload: AgentPayload): Promise<CliResponse> {
    const started = Date.now();
    const decision = await this.route(payload);
    this.logger.info('Dispatching task', {
      traceId: payload.traceId,
      prompt: payload.prompt,
      intents: decision.intents,
      confidence: decision.confidence,
    });

    // Fan-out in parallel; Promise.all preserves decision order.
    const results: AgentResult[] = await Promise.all(
      decision.intents.map(async (intent): Promise<AgentResult> => {
        const agent = this.registry.get(intent);
        if (agent === undefined) {
          this.logger.warn('No agent registered for intent; skipping', { traceId: payload.traceId, intent });
          return { agent: 'orchestrator', intent, success: false, summary: `No agent registered for intent "${intent}"`, durationMs: 0 };
        }
        try {
          const scoped: AgentPayload = { ...payload, intents: [intent] };
          const result = await withTimeout(agent.execute(scoped), payload.options.timeoutMs, agent.name);
          this.logger.info('Agent completed', {
            traceId: payload.traceId,
            agent: result.agent,
            success: result.success,
            durationMs: result.durationMs,
          });
          return result;
        } catch (err: unknown) {
          const wrapped =
            err instanceof AgentExecutionError
              ? err
              : new AgentExecutionError(agent.name, err instanceof Error ? err.message : String(err), undefined, err);
          this.logger.error('Agent failed', {
            traceId: payload.traceId,
            agent: agent.name,
            error: wrapped.message,
          });
          return {
            agent: agent.name,
            intent,
            success: false,
            summary: wrapped.message,
            durationMs: 0,
          };
        }
      }),
    );

    return {
      traceId: payload.traceId,
      prompt: payload.prompt,
      intents: decision.intents,
      dryRun: payload.options.dryRun,
      results,
      durationMs: Date.now() - started,
    };
  }
}
