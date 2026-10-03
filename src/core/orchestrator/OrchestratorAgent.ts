import type winston from 'winston';
import type {
  AgentIntent,
  AgentPayload,
  AgentResult,
  CliResponse,
  ComplexityLevel,
  RoutingDecision,
  UnifiedAgentContext,
  UrgencyScore,
} from '../../types/index.js';
import type { IAgent } from '../agents/agents.js';
import { CodeAgent, EnvironmentAgent, SecurityAgent } from '../agents/agents.js';
import { AgentExecutionError } from '../../utils/errors.js';
import type { IOrchestratorAgent } from './IOrchestratorAgent.js';
import { LayaRouter } from '../routing/LayaRouter.js';
import { ProjectIndexer } from '../rag/ProjectIndexer.js';

export interface OrchestratorDeps {
  logger: winston.Logger;
  /** Injectable registry — swap / extend without touching routing logic (O/CP). */
  agents?: IAgent[] | undefined;
  /** Injectable Laya adapter — pass a mock `decider` in tests. Built from env when omitted. */
  layaRouter?: LayaRouter | undefined;
  /** Injectable RAG indexer — pass a stub in tests. Built with defaults when omitted. */
  indexer?: ProjectIndexer | undefined;
  /** Choice confidence below this falls back to the keyword heuristic. Defaults to 0.35. */
  minConfidence?: number | undefined;
  /** Top-K chunks retrieved per dispatch. Defaults to 5. */
  ragTopK?: number | undefined;
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
 * Default orchestrator: Laya-typed routing + RAG-enriched fan-out delegation.
 *
 * Responsibilities (SRP):
 *  1. `route()` — decision step: explicit flags → Laya sidecar →
 *     keyword-heuristic fallback (sidecar down or low confidence).
 *  2. `dispatch()` — retrieve RAG context, attach a `UnifiedAgentContext`
 *     to each scoped payload, execute agents in parallel, aggregate.
 */
export class OrchestratorAgent implements IOrchestratorAgent {
  private readonly logger: winston.Logger;
  private readonly registry: Map<AgentIntent, IAgent>;
  private readonly layaRouter: LayaRouter;
  private readonly indexer: ProjectIndexer;
  private readonly minConfidence: number;
  private readonly ragTopK: number;

  public constructor(deps: OrchestratorDeps) {
    this.logger = deps.logger;
    const agents: IAgent[] = deps.agents ?? [new CodeAgent(), new SecurityAgent(), new EnvironmentAgent()];
    this.registry = new Map(agents.map((a) => [a.intent, a]));
    this.layaRouter = deps.layaRouter ?? new LayaRouter();
    this.indexer = deps.indexer ?? new ProjectIndexer({ logger: deps.logger });
    this.minConfidence = deps.minConfidence ?? 0.35;
    this.ragTopK = deps.ragTopK ?? 5;
  }

  public listAgents(): string[] {
    return [...this.registry.values()].map((a) => `${a.name} (${a.intent})`);
  }

  /**
   * Typed decision routing.
   *
   * Order: explicit CLI flags (deterministic, confidence 1.0) →
   * Laya `choice` question (single forward pass also yields `urgency`
   * noul + `complexity` score) → keyword-heuristic fallback when the
   * sidecar is unreachable or the winning choice is under-confident.
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

    try {
      const outcome = await this.layaRouter.decide(payload.prompt);
      if (outcome.intentConfidence < this.minConfidence) {
        this.logger.warn('Laya choice confidence below threshold — using heuristic fallback', {
          traceId: payload.traceId,
          intent: outcome.intent,
          confidence: outcome.intentConfidence,
          threshold: this.minConfidence,
        });
        return {
          ...this.heuristicRoute(payload.prompt),
          reason: `laya low-confidence (${outcome.intentConfidence.toFixed(2)} < ${this.minConfidence}) → keyword heuristic`,
          urgency: outcome.urgency,
          complexity: outcome.complexity,
        };
      }
      this.logger.debug('Routing decision (laya-MLX)', {
        traceId: payload.traceId,
        intent: outcome.intent,
        confidence: outcome.intentConfidence,
        urgency: outcome.urgency,
        complexity: outcome.complexity,
        model: outcome.model,
      });
      return {
        intents: [outcome.intent],
        confidence: outcome.intentConfidence,
        reason: `laya-MLX choice (urgency=${outcome.urgency.toFixed(2)}, complexity=${outcome.complexity})`,
        urgency: outcome.urgency,
        complexity: outcome.complexity,
      };
    } catch (err: unknown) {
      // Sidecar down / validation / timeout → deterministic fallback.
      this.logger.warn('Laya sidecar unavailable — using heuristic fallback', {
        traceId: payload.traceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ...this.heuristicRoute(payload.prompt),
        reason: `laya unavailable (${err instanceof Error ? err.message : String(err)}) → keyword heuristic`,
      };
    }
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

    // Best-effort RAG: retrieval never fails dispatch (→ [] on outage).
    const context = await this.buildContext(payload, decision);

    // Fan-out in parallel; Promise.all preserves decision order.
    const results: AgentResult[] = await Promise.all(
      decision.intents.map(async (intent): Promise<AgentResult> => {
        const agent = this.registry.get(intent);
        if (agent === undefined) {
          this.logger.warn('No agent registered for intent; skipping', { traceId: payload.traceId, intent });
          return { agent: 'orchestrator', intent, success: false, summary: `No agent registered for intent "${intent}"`, durationMs: 0 };
        }
        try {
          const scoped: AgentPayload = { ...payload, intents: [intent], context };
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

  /**
   * Deterministic keyword-heuristic fallback.
   * Word boundaries prevent substring false positives:
   * "login"/"catalog" must not trigger monitor via "log",
   * "decode" must not trigger analyze via "code".
   */
  private heuristicRoute(prompt: string): RoutingDecision {
    const text = prompt.toLowerCase();
    const intents = new Set<AgentIntent>();
    if (/\b(secur\w*|vuln\w*|cve|xss|sast|injection|pen-?\s?test|threat|audit)\b/.test(text)) intents.add('secure');
    // Infra keywords stay narrow on purpose: bare "service"/"image"/"memory"
    // also appear in code tasks ("AuthService", "image gallery", "memory leak"),
    // so only docker/k8s-ecosystem terms force monitor here.
    if (
      /\b(monitor\w*|health\w*|uptime|metrics?|logs?|deploy\w*|infra\w*|environments?|docker\w*|containers?|compose|kubernetes|k8s|kubectl|pods?|podman|helm)\b/.test(
        text,
      )
    )
      intents.add('monitor');
    if (/\b(analy[sz]e|review\w*|refactor\w*|lint\w*|explain|code|typescript|function|bugs?)\b/.test(text))
      intents.add('analyze');
    if (intents.size === 0) intents.add('analyze'); // safe default for bootstrap
    return { intents: [...intents], confidence: 0.5, reason: 'keyword heuristic' };
  }

  /** Retrieve top-K chunks and pack the unified context envelope for agents. */
  private async buildContext(payload: AgentPayload, decision: RoutingDecision): Promise<UnifiedAgentContext> {
    let chunks: Awaited<ReturnType<ProjectIndexer['retrieveContext']>> = [];
    try {
      chunks = await this.indexer.retrieveContext(payload.prompt, this.ragTopK);
    } catch (err: unknown) {
      this.logger.warn('RAG retrieval failed — continuing without codebase context', {
        traceId: payload.traceId,
        error: err instanceof Error ? err.message : String(err),
      });
      chunks = [];
    }
    const urgency: UrgencyScore = decision.urgency ?? 0.5;
    const complexity: ComplexityLevel = decision.complexity ?? 1;
    return {
      traceId: payload.traceId,
      prompt: payload.prompt,
      retrievedChunks: chunks,
      contextText: this.indexer.formatContext(chunks),
      urgency,
      complexity,
      routingReason: decision.reason,
      confidence: decision.confidence,
    };
  }
}
