#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
require("dotenv/config");
const program_js_1 = require("./cli/program.js");
const OrchestratorAgent_js_1 = require("./core/orchestrator/OrchestratorAgent.js");
const ProjectIndexer_js_1 = require("./core/rag/ProjectIndexer.js");
const LayaRouter_js_1 = require("./core/routing/LayaRouter.js");
const config_js_1 = require("./utils/config.js");
const errors_js_1 = require("./utils/errors.js");
const logger_js_1 = require("./utils/logger.js");
async function main() {
    (0, errors_js_1.installGlobalErrorHandlers)(logger_js_1.logger);
    const config = (0, config_js_1.loadHelixConfig)();
    const layaRouter = new LayaRouter_js_1.LayaRouter({ url: config.layaUrl, timeout: config.layaTimeoutMs });
    const indexer = new ProjectIndexer_js_1.ProjectIndexer({
        logger: logger_js_1.logger,
        chromaHost: config.chromaHost,
        chromaPort: config.chromaPort,
        chromaSsl: config.chromaSsl,
        collectionName: config.chromaCollection,
    });
    // Pass the base logger; program.handlePrompt creates a per-request
    // child (traceId) so concurrent/multi-agent traces stay correlated.
    const orchestrator = new OrchestratorAgent_js_1.OrchestratorAgent({
        logger: logger_js_1.logger,
        layaRouter,
        indexer,
        minConfidence: config.layaMinConfidence,
        ragTopK: config.ragTopK,
    });
    const program = (0, program_js_1.buildProgram)({ orchestrator, logger: logger_js_1.logger, indexer, config });
    try {
        await program.parseAsync(process.argv);
    }
    catch (err) {
        if ((0, errors_js_1.isHelixError)(err)) {
            logger_js_1.logger.error(err.message, { code: err.code, context: err.context });
            console.error(`Error [${err.code}]: ${err.message}`);
            process.exit(err.exitCode);
        }
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        logger_js_1.logger.error('Fatal error', { error: message, stack });
        console.error(`Fatal: ${message}`);
        process.exit(1);
    }
}
void main();
