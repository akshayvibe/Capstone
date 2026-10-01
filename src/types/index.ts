/**
 * HELIX shared type definitions.
 *
 * Single-responsibility: pure types only, no runtime logic.
 * These types form the contract between the CLI routing layer,
 * the orchestrator, and downstream sub-agents.
 */

/** Operational intents selectable via CLI flags / subcommands. */
export type AgentIntent = 'analyze' | 'secure' | 'monitor';

/** Raw options parsed by commander (before normalization). */
export interface RawCliOptions {
  analyze?: boolean | undefined;
  secure?: boolean | undefined;
  monitor?: boolean | undefined;
  verbose?: boolean | undefined;
  json?: boolean | undefined;
  dryRun?: boolean | undefined;
  timeout?: string | undefined;
}

/** Normalized, validated CLI options used across the app. */
export interface CliOptions {
  analyze: boolean;
  secure: boolean;
  monitor: boolean;
  verbose: boolean;
  json: boolean;
  dryRun: boolean;
  /** Timeout in milliseconds. */
  timeoutMs: number;
}

/** Natural-language task submitted through the CLI. */
export interface AgentPayload {
  /** Raw user prompt, e.g. "audit auth module for injection flaws". */
  prompt: string;
  /** Derived intents from flags / routing heuristics. */
  intents: AgentIntent[];
  /** Correlation id for distributed tracing across agents. */
  traceId: string;
  /** Effective CLI options after normalization. */
  options: CliOptions;
}

/** Standard envelope every agent must return. */
export interface AgentResult {
  agent: string;
  intent: AgentIntent;
  success: boolean;
  summary: string;
  /** Agent-specific structured data (kept unknown to preserve decoupling). */
  data?: unknown;
  durationMs: number;
}

/** Unified CLI response printed to stdout (human or JSON). */
export interface CliResponse {
  traceId: string;
  prompt: string;
  intents: AgentIntent[];
  dryRun: boolean;
  results: AgentResult[];
  /** Total orchestrator wall-clock time. */
  durationMs: number;
}

/** Decision produced by the (future laya-mlx) routing model. */
export interface RoutingDecision {
  intents: AgentIntent[];
  confidence: number;
  reason: string;
}
