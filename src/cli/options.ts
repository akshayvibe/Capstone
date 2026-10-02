import type { AgentIntent, CliOptions, RawCliOptions } from '../types/index.js';
import { CliValidationError } from '../utils/errors.js';

export const DEFAULT_TIMEOUT_MS = 30_000;

/** Normalize raw commander options into a validated CliOptions object. */
export function normalizeOptions(raw: RawCliOptions): CliOptions {
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (raw.timeout !== undefined) {
    const parsed = Number(raw.timeout);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new CliValidationError(`Invalid --timeout value: "${raw.timeout}". Expected a positive number of ms.`);
    }
    timeoutMs = Math.floor(parsed);
  }
  return {
    analyze: raw.analyze === true,
    secure: raw.secure === true,
    monitor: raw.monitor === true,
    verbose: raw.verbose === true,
    json: raw.json === true,
    dryRun: raw.dryRun === true,
    timeoutMs,
  };
}

/** Derive explicit intents from flags; empty => let orchestrator infer. */
export function intentsFromOptions(opts: CliOptions): AgentIntent[] {
  const intents: AgentIntent[] = [];
  if (opts.analyze) intents.push('analyze');
  if (opts.secure) intents.push('secure');
  if (opts.monitor) intents.push('monitor');
  return intents;
}
