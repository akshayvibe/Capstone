#!/usr/bin/env node
/**
 * HELIX CLI entrypoint.
 *
 * Thin bootstrap only (SRP): resolves config -> builds the Laya router
 * and RAG indexer -> wires the orchestrator -> commander, installs
 * global error handlers, and parses argv. All business logic lives
 * behind `IOrchestratorAgent`; this file must stay free of it.
 *
 * Both sidecars are best-effort: a missing Laya sidecar degrades to
 * heuristic routing, and a missing ChromaDB server degrades to
 * in-memory keyword retrieval. Boot never fails for either.
 */
import { buildProgram } from './cli/program.js';
import { OrchestratorAgent } from './core/orchestrator/OrchestratorAgent.js';
import { ProjectIndexer } from './core/rag/ProjectIndexer.js';
import { LayaRouter } from './core/routing/LayaRouter.js';
import { loadHelixConfig } from './utils/config.js';
import { isHelixError, installGlobalErrorHandlers } from './utils/errors.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  installGlobalErrorHandlers(logger);

  const config = loadHelixConfig();
  const layaRouter = new LayaRouter({ url: config.layaUrl, timeout: config.layaTimeoutMs });
  const indexer = new ProjectIndexer({
    logger,
    chromaHost: config.chromaHost,
    chromaPort: config.chromaPort,
    chromaSsl: config.chromaSsl,
    collectionName: config.chromaCollection,
  });

  // Pass the base logger; program.handlePrompt creates a per-request
  // child (traceId) so concurrent/multi-agent traces stay correlated.
  const orchestrator = new OrchestratorAgent({
    logger,
    layaRouter,
    indexer,
    minConfidence: config.layaMinConfidence,
    ragTopK: config.ragTopK,
  });
  const program = buildProgram({ orchestrator, logger, indexer });

  try {
    await program.parseAsync(process.argv);
  } catch (err: unknown) {
    if (isHelixError(err)) {
      logger.error(err.message, { code: err.code, context: err.context });
      console.error(`Error [${err.code}]: ${err.message}`);
      process.exit(err.exitCode);
    }
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error('Fatal error', { error: message, stack });
    console.error(`Fatal: ${message}`);
    process.exit(1);
  }
}

void main();
