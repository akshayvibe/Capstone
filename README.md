# HELIX — AI-powered multi-agent software development assistant

Unified CLI framework (Phase 1) + Laya-MLX typed routing and ChromaDB
Retrieval-Augmented Generation (Phase 2) + specialized analysis sub-agents
(CodeAgent, SecurityAgent, EnvironmentAgent) (Phase 3).

## Quickstart

```bash
npm install
npm run build
npm test

node dist/index.js "audit auth for injection flaws" --secure
node dist/index.js "refactor login handler" --analyze --json
node dist/index.js "what is running" --monitor
node dist/index.js agents
```

`--dry-run` prints the routing decision without executing agents.
`npm run dev -- <args>` runs the same CLI from source via ts-node.

### Interactive mode

```bash
node dist/index.js chat                      # REPL: tasks + slash commands
node dist/index.js chat "first task" --json  # run one task, then keep looping
```

Inside the loop, append `--analyze` / `--secure` / `--monitor` to force
routing for that line. Slash commands: `/agents`, `/index [path]`
(re-index files for RAG), `/json` (toggle JSON output), `/help`,
`/exit` (Ctrl+C / Ctrl+D also quit).

### Terminal UI

```bash
node dist/index.js ui
```

Full-screen terminal dashboard (alternate screen buffer — your scrollback
is untouched): live status header with spinner, scrollable results,
single-line composer with history (↑/↓), cursor + word editing
(Ctrl+A/E/W/U/K), message scrolling (PgUp/PgDn), Tab-completion for
slash commands, and modal overlays for `/agents` and `/help`.
When `OPENROUTER_API_KEY` is set, the TUI also auto-routes tasks to agents
and shows an LLM-generated summary after the agent results.
Slash commands: `/agents`, `/index [path]`, `/mode <auto|analyze|secure|
monitor>`, `/help`, `/exit`. Needs a TTY — for piped input use
`helix chat` instead.

### Interactive chat with OpenRouter

Set an OpenRouter API key to enable conversational responses powered by an
LLM. The chat loop retrieves relevant codebase context from the RAG index and
automatically routes questions to the right agents (code, security, environment)
using the same logic as the orchestrator. You can also force a specific agent
with `--analyze` / `--secure` / `--monitor`.

Copy `.env.example` to `.env` and add your key:

```bash
cp .env.example .env
# edit .env and set OPENROUTER_API_KEY
```

Or export it directly:

```bash
export OPENROUTER_API_KEY="sk-or-..."
# optional overrides
export OPENROUTER_MODEL="openai/gpt-4o-mini"   # default
export OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"
```

Then run:

```bash
node dist/index.js chat
```

Without `OPENROUTER_API_KEY`, `helix chat` still works in agent-only mode.

Both sidecars below are **best-effort**: with nothing running, HELIX
degrades to keyword-heuristic routing + in-memory keyword retrieval.

## Architecture at a glance

```
CLI / chat / TUI
       │
       ▼
┌──────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Orchestrator    │────▶│   LayaRouter │────▶│  ProjectIndexer │
│  (dispatch)      │     │  (route)     │     │  (RAG context)  │
└──────────────────┘     └──────────────┘     └─────────────────┘
       │
       ├─▶ CodeAgent       (analyze)
       ├─▶ SecurityAgent   (secure)
       └─▶ EnvironmentAgent(monitor)
```

The orchestrator fans out a `UnifiedAgentContext` to every delegated agent
and aggregates normalized `AgentReport` results. Agents are decoupled from
each other and from the routing/RAG internals.

## Phase 2: Laya-MLX routing (`src/core/routing/`)

`LayaRouter.decide(prompt)` asks one bound question set in a single
`POST /v1/systemone` forward pass (~33 ms):

| Question     | Type   | Purpose                                            |
| ------------ | ------ | -------------------------------------------------- |
| `route`      | choice | `analyze` \| `secure` \| `monitor` agent routing   |
| `urgency`    | noul   | P(request is urgent / blocking)                    |
| `complexity` | score  | rubric `low` (0) / `medium` (1) / `high` (2)       |

Transport: [`laya-http-client`](https://www.npmjs.com/package/laya-http-client)
(`createDecider`) is loaded lazily as the primary transport. That package
publishes raw TypeScript, which stock Node.js cannot `require()` from
`node_modules`, so on plain Node the router uses the wire-compatible
`fetch` transport in `layaWire.ts` (same endpoint, error codes, and
per-question validation). No behavior change either way.

Point at a local sidecar (official `laya-serve` or the MLX bridge):

```bash
export LAYA_SIDECAR_URL=http://127.0.0.1:8000   # default
export HELIX_LAYA_TIMEOUT_MS=3000               # default
export HELIX_MIN_CONFIDENCE=0.35                # choice confidence floor
```

Fallback: sidecar unreachable **or** winning-choice confidence below
`HELIX_MIN_CONFIDENCE` → deterministic keyword heuristic (same regexes
as Phase 1), with the reason recorded on the `RoutingDecision`.

## Phase 2: RAG / ChromaDB (`src/core/rag/`)

`ProjectIndexer` chunks local source + docs (`.ts/.js/.json/.md/.txt/.yml…`,
`node_modules/dist/.git` excluded) into a ChromaDB collection and
`retrieveContext(query, topK)` returns the most relevant `RetrievedChunk[]`,
which the orchestrator packs into a `UnifiedAgentContext` on every
delegated `AgentPayload`.

```bash
# Start a local ChromaDB (default port 8000)…
chroma run
# …but note the Laya sidecar also defaults to 8000: run one of them
# elsewhere, e.g.
export CHROMA_PORT=8001
```

```bash
export CHROMA_HOST=127.0.0.1 CHROMA_PORT=8000 CHROMA_SSL=false
export CHROMA_COLLECTION=helix_project   # default
export HELIX_RAG_TOP_K=5                 # default
```

Embeddings default to the offline, deterministic `HashEmbeddingFunction`
(no downloads, no keys). For production semantic quality, inject e.g.
`DefaultEmbeddingFunction` from `@chroma-core/default-embed` into
`ProjectIndexer` — one constructor argument; indexing and querying share it.

ChromaDB down (or a failed query) never fails a dispatch: the indexer keeps
in-memory docs and degrades to keyword-overlap ranking (`fallbackMode`).

## Phase 3: Specialized sub-agents (`src/core/agents/`)

Three concrete agents inherit from `BaseAgent` and return a normalized
`AgentReport` via `AgentResult.data`:

| Agent | Intent | What it does |
| ----- | ------ | ------------ |
| `CodeAgent` | `analyze` | Parses `.ts/.tsx/.js/.jsx` with `web-tree-sitter`; runs AST rules for syntax errors, loose equality, empty catches, unreachable code, `var`, `any`, floating promises, and function metrics. |
| `SecurityAgent` | `secure` | Wraps `semgrep`, `gitleaks`, and `npm audit`; parses JSON with Zod; maps findings to severity-ranked issues; redacts secrets in evidence. |
| `EnvironmentAgent` | `monitor` | Probes Docker, Git, OS processes, listening ports, and system metrics (`os`); one failing probe never suppresses the others. |

### Example commands

```bash
# Static code analysis (tree-sitter based)
node dist/index.js "review the auth module" --analyze --json

# Security scan (semgrep + gitleaks + npm audit)
node dist/index.js "audit for secrets and vulnerabilities" --secure

# Environment snapshot (Docker, Git, processes, ports, system load)
node dist/index.js "what containers and services are running" --monitor
```

### Normalized report model

Every agent returns the same `AgentReport` shape:

```ts
interface AgentReport {
  agent: string;
  intent: AgentIntent;
  generatedAt: string;          // ISO-8601
  issues: AgentIssue[];
  counts: { critical: number; high: number; medium: number; low: number; info: number };
  filesScanned: number;
  toolsUsed: string[];          // e.g. ["semgrep 1.0.0", "npm 12.2.0"]
  toolsUnavailable: string[];   // missing / failed tools, as info issues
  rawEvidence?: unknown;        // only under --verbose, capped in size
}
```

Each `AgentIssue` carries `severity` (`critical` → `info`), `category`
(`bug`, `code-quality`, `vulnerability`, `secret`, `dependency`,
`misconfiguration`, `environment`), location, bounded `evidence`, and an
optional `remediation` hint.

### Graceful degradation

All agents degrade gracefully when external tools are missing: the missing
tool is reported as an `info` issue in `toolsUnavailable` rather than failing
the whole run. Raw tool output is attached only under `--verbose` and capped
in size.

External tools required for full functionality:

- `semgrep` (SAST) — configure rules via `HELIX_SEMGREP_CONFIG` (default `auto`).
- `gitleaks` (secret detection).
- `npm` (dependency audit; requires a lockfile).
- `docker`, `git`, `lsof`/`netstat`, `ps`/`tasklist` (environment probes).

Environment variables (see `.env.example`):

```bash
# OpenRouter chat integration
export OPENROUTER_API_KEY="sk-or-..."
export OPENROUTER_MODEL="openai/gpt-4o-mini"     # default
export OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"

# Agents / tooling
export HELIX_SEMGREP_CONFIG=auto          # or p/typescript, local rule dir, etc.
export HELIX_CODE_MAX_FILES=200           # CodeAgent scan budget
export HELIX_AGENT_TOOL_TIMEOUT_MS=60000  # per-tool subprocess timeout
```

## Testing

Tests use Node's built-in test runner (`node:test`) so no extra test
dependencies are needed.

```bash
npm test
```

This compiles `tests/**/*` via `tsconfig.test.json` into `dist-tests/` and
runs them with `node --test`.

Test coverage:

- `tests/exec.test.ts` — safe command runner and error classification.
- `tests/security/schemas.test.ts` — Zod schema validation for semgrep,
  gitleaks, and npm audit JSON outputs.
- `tests/security/tools.test.ts` — issue mapping and secret redaction.
- `tests/code/rules.test.ts` — tree-sitter AST rule detection on fixture
  source files.

## Layout

- `src/index.ts` — thin bootstrap: config → `LayaRouter` + `ProjectIndexer`
  → `OrchestratorAgent` → commander.
- `src/cli/program.ts` — one-shot commands (`run`, `analyze`, `secure`,
  `monitor`, `agents`, `chat`, `ui`); `src/cli/chat.ts` — line REPL loop;
  `src/cli/tui/` — full-screen terminal UI (`tui.ts`, raw-mode `keys.ts`,
  `ansi.ts`, `text.ts`); `src/cli/options.ts` + `src/cli/render.ts` —
  shared flag normalization and response rendering.
- `src/core/agents/` — `IAgent`/`BaseAgent` contract plus `CodeAgent`,
  `SecurityAgent`, and `EnvironmentAgent` with their parsers, rules, tool
  wrappers, and environment probes.
- `src/core/llm/OpenRouterClient.ts` — OpenAI-compatible client for
  OpenRouter chat completions.
- `src/core/orchestrator/OrchestratorAgent.ts` — flags → Laya → heuristic
  routing; RAG-enriched parallel fan-out with per-agent timeouts.
- `src/core/routing/LayaRouter.ts`, `layaWire.ts` — typed decision adapter.
- `src/core/rag/ProjectIndexer.ts`, `HashEmbeddingFunction.ts` — RAG layer.
- `src/types/index.ts` — strict contracts: Laya payloads, ChromaDB
  metadata, `UnifiedAgentContext`, `AgentReport`, runtime config.
- `src/utils/config.ts` — env-driven `HelixConfig`; `src/utils/errors.ts` —
  `LayaUnavailableError`, `VectorStoreError`, `Tool*Error`, `AstParseError`;
  `src/utils/exec.ts` — shared safe subprocess runner.
