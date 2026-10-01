import type { AgentPayload, CliResponse, RoutingDecision } from '../../types/index.js';

/**
 * Contract for the central orchestrator.
 *
 * Dependency Inversion: the CLI routing layer depends on this
 * abstraction, never on a concrete orchestrator implementation.
 *
 * Future integration point: `route()` will call into `laya-mlx`
 * for fast, typed decision routing. Today it uses a deterministic
 * keyword heuristic behind the same typed boundary.
 */
export interface IOrchestratorAgent {
  /** Decide which sub-agents should handle the payload. */
  route(payload: AgentPayload): Promise<RoutingDecision>;
  /** Delegate to sub-agents and aggregate a unified CLI response. */
  dispatch(payload: AgentPayload): Promise<CliResponse>;
  /** Convenience: list registered sub-agent names (for `helix agents`). */
  listAgents(): string[];
}
