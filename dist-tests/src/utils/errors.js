"use strict";
/**
 * Domain errors — kept separate from logging and CLI rendering
 * so each layer has a single responsibility.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AstParseError = exports.ToolOutputParseError = exports.ToolExecutionError = exports.ToolUnavailableError = exports.VectorStoreError = exports.LayaUnavailableError = exports.AgentExecutionError = exports.CliValidationError = exports.HelixError = void 0;
exports.isHelixError = isHelixError;
exports.installGlobalErrorHandlers = installGlobalErrorHandlers;
/** Base class carrying an exit code and structured context. */
class HelixError extends Error {
    code;
    exitCode;
    context;
    constructor(message, opts = {}) {
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
exports.HelixError = HelixError;
/** Invalid user input / CLI usage. */
class CliValidationError extends HelixError {
    constructor(message, context) {
        super(message, { code: 'CLI_VALIDATION_ERROR', exitCode: 2, context });
    }
}
exports.CliValidationError = CliValidationError;
/** A sub-agent failed to fulfil its delegated task. */
class AgentExecutionError extends HelixError {
    agent;
    constructor(agent, message, context, cause) {
        super(`[${agent}] ${message}`, { code: 'AGENT_EXECUTION_ERROR', exitCode: 3, context, cause });
        this.agent = agent;
    }
}
exports.AgentExecutionError = AgentExecutionError;
/** The Laya-MLX sidecar could not produce a routing decision. */
class LayaUnavailableError extends HelixError {
    constructor(message, context, cause) {
        super(message, { code: 'LAYA_UNAVAILABLE', exitCode: 3, context, cause });
    }
}
exports.LayaUnavailableError = LayaUnavailableError;
/** The ChromaDB vector store is unreachable or returned an invalid result. */
class VectorStoreError extends HelixError {
    constructor(message, context, cause) {
        super(message, { code: 'VECTOR_STORE_ERROR', exitCode: 3, context, cause });
    }
}
exports.VectorStoreError = VectorStoreError;
/** An external CLI tool (semgrep, gitleaks, docker, etc.) is not installed. */
class ToolUnavailableError extends HelixError {
    tool;
    constructor(tool, message, context, cause) {
        super(`[${tool}] ${message}`, { code: 'TOOL_UNAVAILABLE', exitCode: 3, context, cause });
        this.tool = tool;
    }
}
exports.ToolUnavailableError = ToolUnavailableError;
/** An external CLI tool executed but returned a non-zero or otherwise unexpected status. */
class ToolExecutionError extends HelixError {
    tool;
    constructor(tool, message, context, cause) {
        super(`[${tool}] ${message}`, { code: 'TOOL_EXECUTION_ERROR', exitCode: 3, context, cause });
        this.tool = tool;
    }
}
exports.ToolExecutionError = ToolExecutionError;
/** An external CLI tool returned output that could not be parsed or schema-validated. */
class ToolOutputParseError extends HelixError {
    tool;
    constructor(tool, message, context, cause) {
        super(`[${tool}] ${message}`, { code: 'TOOL_OUTPUT_PARSE_ERROR', exitCode: 3, context, cause });
        this.tool = tool;
    }
}
exports.ToolOutputParseError = ToolOutputParseError;
/** A source file could not be parsed by the tree-sitter parser. */
class AstParseError extends HelixError {
    filePath;
    constructor(filePath, message, context, cause) {
        super(`[${filePath}] ${message}`, { code: 'AST_PARSE_ERROR', exitCode: 3, context, cause });
        this.filePath = filePath;
    }
}
exports.AstParseError = AstParseError;
/** Type guard for HelixError. */
function isHelixError(err) {
    return err instanceof HelixError;
}
/**
 * Install global crash handlers. Call once from the entrypoint.
 * Converts uncaught exceptions / unhandled rejections into
 * structured log lines with a deterministic exit code.
 */
function installGlobalErrorHandlers(log) {
    process.on('uncaughtException', (err) => {
        log.error('Uncaught exception', {
            error: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : String(err),
        });
        process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
        log.error('Unhandled promise rejection', {
            error: reason instanceof Error ? { message: reason.message, stack: reason.stack, name: reason.name } : String(reason),
        });
        process.exit(1);
    });
}
