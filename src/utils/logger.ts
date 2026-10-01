import winston from 'winston';

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

export const logger: winston.Logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: 'helix' },
  transports: [
    new winston.transports.Console({
      format:
        process.env['LOG_FORMAT'] === 'json'
          ? winston.format.combine(winston.format.timestamp(), winston.format.json())
          : winston.format.combine(
              winston.format.colorize(),
              winston.format.timestamp({ format: 'HH:mm:ss' }),
              winston.format.printf(({ timestamp, level, message, traceId, ...rest }) => {
                const trace = typeof traceId === 'string' ? ` [${traceId}]` : '';
                const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
                return `${String(timestamp)} ${String(level)}${trace} ${String(message)}${extra}`;
              }),
            ),
    }),
  ],
});

/** Create a trace-scoped child logger for one CLI invocation. */
export function childLogger(traceId: string): winston.Logger {
  return logger.child({ traceId });
}
