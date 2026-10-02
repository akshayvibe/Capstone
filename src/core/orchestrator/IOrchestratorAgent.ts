import type { AgentPayload, CliResponse, RoutingDecision } from '../../types/index.js';

/**
 * Contract for the central orchestrator.
 *
 * Dependency Inversion: the CLI routing layer depends on this
 * abstraction, never on a concrete orchestrator implementation.
 *
 * `route()` resolves via the Laya-MLX sidecar (`LayaRouter`) with a
 * deterministic keyword-heuristic fallback; `dispatch()` additionally
 * fans out RAG context from `ProjectIndexer` to every sub-agent.
 */
export interface IOrchestratorAgent {
  /** Decide which sub-agents should handle the payload. */
  route(payload: AgentPayload): Promise<RoutingDecision>;
  /** Delegate to sub-agents and aggregate a unified CLI response. */
  dispatch(payload: AgentPayload): Promise<CliResponse>;
  /** Convenience: list registered sub-agent names (for `helix agents`). */
  listAgents(): string[];
}
