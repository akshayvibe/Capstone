"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.childLogger = childLogger;
const winston_1 = __importDefault(require("winston"));
/**
 * Structured logger (winston) — the single logging entrypoint.
 *
 * - JSON with timestamp + service name for machine parsing.
 * - Human-readable dev format to console when not JSON-piped.
 * - `traceId` is threaded through via child metadata, so
 *   multi-agent workflows can be correlated as they scale.
 *
 * SOLID: Dependency Inversion — agents and CLI depend on the
 * `Logger` abstraction (winston.Logger), never on console directly.
 */
const logLevel = process.env['LOG_LEVEL'] ?? (process.env['NODE_ENV'] === 'production' ? 'info' : 'debug');
exports.logger = winston_1.default.createLogger({
    level: logLevel,
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json()),
    defaultMeta: { service: 'helix' },
    transports: [
        new winston_1.default.transports.Console({
            // Logs go to stderr so stdout carries only the rendered CLI
            // response — keeps `--json` output machine-readable even when
            // fallback warnings fire on the dispatch path.
            stderrLevels: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
            format: process.env['LOG_FORMAT'] === 'json'
                ? winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.json())
                : winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.timestamp({ format: 'HH:mm:ss' }), winston_1.default.format.printf(({ timestamp, level, message, traceId, ...rest }) => {
                    const trace = typeof traceId === 'string' ? ` [${traceId}]` : '';
                    const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
                    return `${String(timestamp)} ${String(level)}${trace} ${String(message)}${extra}`;
                })),
        }),
    ],
});
/** Create a trace-scoped child logger for one CLI invocation. */
function childLogger(traceId) {
    return exports.logger.child({ traceId });
}
