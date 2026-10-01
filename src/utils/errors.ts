/**
 * Domain errors — kept separate from logging and CLI rendering
 * so each layer has a single responsibility.
 */

/** Base class carrying an exit code and structured context. */
export class HelixError extends Error {
  public readonly code: string;
  public readonly exitCode: number;
  public readonly context?: Record<string, unknown>;

  public constructor(
    message: string,
    opts: { code?: string; exitCode?: number; context?: Record<string, unknown> | undefined; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = this.constructor.name;
    this.code = opts.code ?? 'HELIX_ERROR';
    this.exitCode = opts.exitCode ?? 1;
    if (opts.context !== undefined) {
      this.context = opts.context;
    }
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/** Invalid user input / CLI usage. */
export class CliValidationError extends HelixError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: 'CLI_VALIDATION_ERROR', exitCode: 2, context });
  }
}

/** A sub-agent failed to fulfil its delegated task. */
export class AgentExecutionError extends HelixError {
  public readonly agent: string;
  public constructor(agent: string, message: string, context?: Record<string, unknown>, cause?: unknown) {
    super(`[${agent}] ${message}`, { code: 'AGENT_EXECUTION_ERROR', exitCode: 3, context, cause });
    this.agent = agent;
  }
}

/** Type guard for HelixError. */
export function isHelixError(err: unknown): err is HelixError {
  return err instanceof HelixError;
}

/**
 * Install global crash handlers. Call once from the entrypoint.
 * Converts uncaught exceptions / unhandled rejections into
 * structured log lines with a deterministic exit code.
 */
export function installGlobalErrorHandlers(log: { error: (...args: unknown[]) => void }): void {
  process.on('uncaughtException', (err: unknown) => {
    log.error('Uncaught exception', {
      error: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : String(err),
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    log.error('Unhandled promise rejection', {
      error: reason instanceof Error ? { message: reason.message, stack: reason.stack, name: reason.name } : String(reason),
    });
    process.exit(1);
  });
}
