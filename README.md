# HELIX — AI-powered multi-agent software development assistant

Unified CLI framework (Phase 1) + Laya-MLX typed routing and ChromaDB
Retrieval-Augmented Generation (Phase 2).

## Quickstart

```bash
npm install
npm run build
node dist/index.js "audit auth for injection flaws" --secure
node dist/index.js "refactor login handler" --analyze --json
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
Both sidecars below are **best-effort**: with nothing running, HELIX
degrades to keyword-heuristic routing + in-memory keyword retrieval.

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

## Layout

- `src/index.ts` — thin bootstrap: config → `LayaRouter` + `ProjectIndexer`
  → `OrchestratorAgent` → commander.
- `src/cli/program.ts` — one-shot commands (`run`, `analyze`, `secure`,
  `monitor`, `agents`, `chat`); `src/cli/chat.ts` — interactive REPL loop;
  `src/cli/options.ts` + `src/cli/render.ts` — shared flag normalization
  and response rendering used by both modes.
- `src/core/orchestrator/OrchestratorAgent.ts` — flags → Laya → heuristic
  routing; RAG-enriched parallel fan-out with per-agent timeouts.
- `src/core/routing/LayaRouter.ts`, `layaWire.ts` — typed decision adapter.
- `src/core/rag/ProjectIndexer.ts`, `HashEmbeddingFunction.ts` — RAG layer.
- `src/types/index.ts` — strict contracts: Laya payloads, ChromaDB
  metadata, `UnifiedAgentContext`, runtime config.
- `src/utils/config.ts` — env-driven `HelixConfig`; `src/utils/errors.ts` —
  `LayaUnavailableError`, `VectorStoreError`.
