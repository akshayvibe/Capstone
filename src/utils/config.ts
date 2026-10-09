import type { HelixConfig } from '../types/index.js';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parsePort(raw: string | undefined, fallback: number): number {
  const port = parsePositiveInt(raw, fallback);
  if (port > 65_535) return fallback;
  return port;
}

function parseConfidence(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/**
 * Resolve runtime configuration from the environment.
 *
 * Supported variables (all optional):
 * - `LAYA_SIDECAR_URL` (alias `HELIX_LAYA_URL`), default `http://127.0.0.1:8000`
 * - `HELIX_LAYA_TIMEOUT_MS`, default `3000`
 * - `HELIX_MIN_CONFIDENCE`, default `0.35`
 * - `CHROMA_HOST`, default `127.0.0.1`
 * - `CHROMA_PORT`, default `8000`
 * - `CHROMA_SSL`, default `false`
 * - `CHROMA_COLLECTION` (alias `HELIX_CHROMA_COLLECTION`), default `helix_project`
 * - `HELIX_RAG_TOP_K`, default `5`
 *
 * NOTE: a default ChromaDB server and the Laya sidecar both listen on
 * port 8000. When running both locally, point one of them elsewhere
 * (e.g. `CHROMA_PORT=8001`) — this loader does not guess for you.
 */
export function loadHelixConfig(env: NodeJS.ProcessEnv = process.env): HelixConfig {
  return {
    semgrepConfig: env['HELIX_SEMGREP_CONFIG'] ?? 'auto',
    codeMaxFiles: parsePositiveInt(env['HELIX_CODE_MAX_FILES'], 200),
    agentToolTimeoutMs: parsePositiveInt(env['HELIX_AGENT_TOOL_TIMEOUT_MS'], 60_000),
    openRouterApiKey: env['OPENROUTER_API_KEY'],
    openRouterModel: env['OPENROUTER_MODEL'] ?? 'openai/gpt-4o-mini',
    openRouterBaseUrl: env['OPENROUTER_BASE_URL'] ?? 'https://openrouter.ai/api/v1',
    layaUrl: env['LAYA_SIDECAR_URL'] ?? env['HELIX_LAYA_URL'] ?? 'http://127.0.0.1:8000',
    layaTimeoutMs: parsePositiveInt(env['HELIX_LAYA_TIMEOUT_MS'], 3000),
    layaMinConfidence: parseConfidence(env['HELIX_MIN_CONFIDENCE'], 0.35),
    chromaHost: env['CHROMA_HOST'] ?? '127.0.0.1',
    chromaPort: parsePort(env['CHROMA_PORT'], 8000),
    chromaSsl: parseBool(env['CHROMA_SSL'], false),
    chromaCollection: env['CHROMA_COLLECTION'] ?? env['HELIX_CHROMA_COLLECTION'] ?? 'helix_project',
    ragTopK: parsePositiveInt(env['HELIX_RAG_TOP_K'], 5),
  };
}
