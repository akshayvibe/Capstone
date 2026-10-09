/**
 * HELIX shared type definitions.
 *
 * Single-responsibility: pure types only, no runtime logic.
 * These types form the contract between the CLI routing layer,
 * the orchestrator, the Laya-MLX sidecar, the ChromaDB RAG layer,
 * and downstream sub-agents.
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

// ---------------------------------------------------------------------------
// Laya-MLX decision payloads (strict wrappers over the laya-http-client wire)
// ---------------------------------------------------------------------------

/**
 * The bound question set HELIX asks Laya per CLI request.
 *
 * - `route` (choice): which specialized agent owns the task.
 * - `urgency` (noul): P(request is urgent / time-sensitive).
 * - `complexity` (score): rubric level 0=low, 1=medium, 2=high.
 *
 * Criteria are `as const`-friendly literals so `createDecider` infers
 * per-question answer unions at compile time.
 */
export interface LayaRoutingQuestions {
  readonly route: {
    readonly type: 'choice';
    readonly instructions: string;
    readonly criteria: Record<AgentIntent, string>;
  };
  readonly urgency: {
    readonly type: 'noul';
    readonly instructions: string;
  };
  readonly complexity: {
    readonly type: 'score';
    readonly instructions: string;
    readonly criteria: readonly ['low', 'medium', 'high'];
  };
}

/** Normalized urgency score in [0, 1] (P(urgent)). */
export type UrgencyScore = number;

/** Normalized complexity rubric level: 0=low, 1=medium, 2=high. */
export type ComplexityLevel = 0 | 1 | 2;

/**
 * Typed outcome of one Laya `POST /v1/systemone` decision round,
 * after per-question validation by `laya-http-client`.
 */
export interface LayaRoutingOutcome {
  /** Winning agent intent from the `route` choice question. */
  intent: AgentIntent;
  /** Calibrated confidence of the winning choice answer. */
  intentConfidence: number;
  /** Full per-label probabilities for observability / debugging. */
  intentProbabilities: Record<string, number>;
  /** P(true) from the `urgency` noul question, in [0, 1]. */
  urgency: UrgencyScore;
  /** Confidence reported alongside the noul answer. */
  urgencyConfidence: number;
  /** Rubric level from the `complexity` score question. */
  complexity: ComplexityLevel;
  /** Confidence reported alongside the score answer. */
  complexityConfidence: number;
  /** Model string echoed by the sidecar (e.g. checkpoint id). */
  model: string;
}

// ---------------------------------------------------------------------------
// ChromaDB / RAG metadata
// ---------------------------------------------------------------------------

/** Source language derived from file extension (coarse but stable). */
export type ProjectFileLanguage =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'yaml'
  | 'text'
  | 'other';

/**
 * Per-chunk metadata stored alongside each ChromaDB document.
 * Constrained to ChromaDB `Metadata` scalar types (string/number/boolean).
 */
export interface ProjectFileMetadata {
  /** Repository-relative path, e.g. `src/core/agents/agents.ts`. */
  filePath: string;
  language: ProjectFileLanguage;
  /** Zero-based chunk index within the source file. */
  chunkIndex: number;
  /** Total chunks produced from the source file. */
  totalChunks: number;
}

/** One retrieved codebase chunk returned by `ProjectIndexer.retrieveContext`. */
export interface RetrievedChunk {
  /** Stable id `<filePath>#chunk-<index>`. */
  id: string;
  /** Raw chunk text (bounded by the indexer's chunk budget). */
  document: string;
  /** Repository-relative source path. */
  filePath: string;
  language: ProjectFileLanguage;
  /** Cosine/L2 distance when reported by ChromaDB; undefined in fallback mode. */
  distance?: number | undefined;
  metadata: ProjectFileMetadata;
}

/** Stats reported after an indexing pass. */
export interface IndexStats {
  filesScanned: number;
  filesIndexed: number;
  chunksUpserted: number;
  collection: string;
  /** True when ChromaDB was unreachable and docs were kept in memory only. */
  fallbackMode: boolean;
}

// ---------------------------------------------------------------------------
// Unified context object passed to sub-agents
// ---------------------------------------------------------------------------

/**
 * Unified context envelope fanned out to every delegated sub-agent.
 * Attached to `AgentPayload.context` so agents stay decoupled from
 * retrieval internals — they only read `retrievedChunks` / `contextText`.
 */
export interface UnifiedAgentContext {
  traceId: string;
  /** Trimmed user prompt that produced this context. */
  prompt: string;
  /** Top-K retrieved codebase chunks, most relevant first. */
  retrievedChunks: RetrievedChunk[];
  /** Pre-formatted `<filePath>\n<document>` rendering for prompt injection. */
  contextText: string;
  /** Urgency P(true) from Laya (or 0.5 default when Laya is unavailable). */
  urgency: UrgencyScore;
  /** Complexity rubric level from Laya (or 1/medium default on fallback). */
  complexity: ComplexityLevel;
  /** Human-readable routing explanation (Laya vs heuristic vs flags). */
  routingReason: string;
  /** Routing confidence that produced the delegation. */
  confidence: number;
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
  /**
   * RAG + routing context fanned out by the orchestrator.
   * Optional so unit tests and dry-run routing can omit retrieval.
   */
  context?: UnifiedAgentContext | undefined;
}

/** Severity level for every issue produced by a sub-agent. */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Location of an issue inside a source file or external report. */
export interface AgentIssueLocation {
  filePath: string;
  line?: number | undefined;
  column?: number | undefined;
  endLine?: number | undefined;
  endColumn?: number | undefined;
}

/** One normalized finding produced by Code, Security, or Environment agents. */
export interface AgentIssue {
  /** Stable identifier, usually `${agent}:${ruleId}:...`. */
  id: string;
  /** Rule, tool check, or probe that produced the issue. */
  ruleId: string;
  /** Short human-readable title. */
  title: string;
  /** Detailed description. */
  message: string;
  severity: Severity;
  /** Logical category for downstream filtering. */
  category:
    | 'bug'
    | 'code-quality'
    | 'vulnerability'
    | 'secret'
    | 'dependency'
    | 'misconfiguration'
    | 'environment';
  location?: AgentIssueLocation | undefined;
  /** Bounded raw evidence (code snippet, redacted match, log line). Never raw secrets. */
  evidence: string;
  /** Optional remediation hint. */
  remediation?: string | undefined;
  /** Tool-specific scalar metadata (CWE, CVE, confidence, etc.). */
  metadata?: Record<string, string | number | boolean> | undefined;
}

/** Normalized report returned by every specialized sub-agent in `AgentResult.data`. */
export interface AgentReport {
  agent: string;
  intent: AgentIntent;
  /** ISO-8601 timestamp when the report was generated. */
  generatedAt: string;
  /** All findings produced by the agent. */
  issues: AgentIssue[];
  /** Count of issues per severity, always populated for every level. */
  counts: Record<Severity, number>;
  /** Number of source files scanned (when applicable). */
  filesScanned: number;
  /** External tools invoked and their resolved versions. */
  toolsUsed: string[];
  /** Tools that were required but unavailable or failed to initialize. */
  toolsUnavailable: string[];
  /** Optional bounded raw output (only included under `--verbose`). */
  rawEvidence?: unknown;
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

/** Decision produced by the routing layer (Laya or heuristic fallback). */
export interface RoutingDecision {
  intents: AgentIntent[];
  confidence: number;
  reason: string;
  /** Urgency / complexity are best-effort: present when Laya answered. */
  urgency?: UrgencyScore | undefined;
  complexity?: ComplexityLevel | undefined;
}

// ---------------------------------------------------------------------------
// Runtime configuration (env-driven, single place to read)
// ---------------------------------------------------------------------------

/** Effective runtime configuration resolved once at boot. */
export interface HelixConfig {
  /** Semgrep rule config passed via `--config` (e.g. `auto`, `p/typescript`, local dir). */
  semgrepConfig: string;
  /** Max source files the CodeAgent will scan. */
  codeMaxFiles: number;
  /** Timeout for external security / environment tool subprocesses. */
  agentToolTimeoutMs: number;
  /** OpenRouter API key for interactive chat responses. */
  openRouterApiKey?: string | undefined;
  /** OpenRouter-compatible model identifier. */
  openRouterModel: string;
  /** OpenRouter API base URL. */
  openRouterBaseUrl: string;
  /** Laya-MLX sidecar base URL (no trailing path). */
  layaUrl: string;
  /** Per-request timeout for the Laya sidecar in ms. */
  layaTimeoutMs: number;
  /** Below this choice confidence the orchestrator falls back to heuristics. */
  layaMinConfidence: number;
  /** ChromaDB server host. */
  chromaHost: string;
  /** ChromaDB server port. */
  chromaPort: number;
  /** Use HTTPS for ChromaDB. */
  chromaSsl: boolean;
  /** Target collection for project embeddings. */
  chromaCollection: string;
  /** Top-K chunks injected per agent prompt. */
  ragTopK: number;
}
