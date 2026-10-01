#!/usr/bin/env node
/**
 * HELIX CLI entrypoint.
 *
 * Thin bootstrap only (SRP): wires logger -> orchestrator -> commander,
 * installs global error handlers, and parses argv. All business logic
 * lives behind `IOrchestratorAgent`; this file must stay free of it.
 */
import { buildProgram } from './cli/program.js';
import { OrchestratorAgent } from './core/orchestrator/OrchestratorAgent.js';
import { isHelixError, installGlobalErrorHandlers } from './utils/errors.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  installGlobalErrorHandlers(logger);

  // Pass the base logger; program.handlePrompt creates a per-request
  // child (traceId) so concurrent/multi-agent traces stay correlated.
  const orchestrator = new OrchestratorAgent({ logger });
  const program = buildProgram({ orchestrator, logger });

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
