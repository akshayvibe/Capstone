import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import type winston from 'winston';
import type { IOrchestratorAgent } from '../core/orchestrator/IOrchestratorAgent.js';
import type { AgentIntent, AgentPayload, CliOptions, CliResponse, RawCliOptions } from '../types/index.js';
import { CliValidationError } from '../utils/errors.js';

export interface CliContext {
  orchestrator: IOrchestratorAgent;
  logger: winston.Logger;
}

const DEFAULT_TIMEOUT_MS = 30_000;

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

/**
 * Merge parent (program) and subcommand options.
 *
 * Commander attributes trailing flags (e.g. `helix analyze foo --json`)
 * to the *program* when both program and subcommand define the same
 * option. OR-merging booleans and falling back for --timeout makes
 * flags work regardless of position.
 */
export function mergeRawOptions(parent: RawCliOptions, own: RawCliOptions): RawCliOptions {
  const defaultTimeout = String(DEFAULT_TIMEOUT_MS);
  const ownTimeout = own.timeout ?? defaultTimeout;
  const parentTimeout = parent.timeout ?? defaultTimeout;
  return {
    analyze: parent.analyze === true || own.analyze === true ? true : undefined,
    secure: parent.secure === true || own.secure === true ? true : undefined,
    monitor: parent.monitor === true || own.monitor === true ? true : undefined,
    verbose: parent.verbose === true || own.verbose === true ? true : undefined,
    json: parent.json === true || own.json === true ? true : undefined,
    dryRun: parent.dryRun === true || own.dryRun === true ? true : undefined,
    timeout: ownTimeout !== defaultTimeout ? ownTimeout : parentTimeout,
  };
}

function sharedOptions(cmd: Command): Command {
  return cmd
    .option('-a, --analyze', 'route to CodeAgent for code analysis')
    .option('-s, --secure', 'route to SecurityAgent for security scanning')
    .option('-m, --monitor', 'route to EnvironmentAgent for environment monitoring')
    .option('--dry-run', 'plan routing without executing agents', false)
    .option('--json', 'emit machine-readable JSON response', false)
    .option('--timeout <ms>', 'per-agent timeout in milliseconds', String(DEFAULT_TIMEOUT_MS))
    .option('-v, --verbose', 'verbose (debug) logging', false);
}

function renderResponse(response: CliResponse, opts: CliOptions): void {
  if (opts.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  console.log(`\nHELIX trace ${response.traceId} (${response.durationMs}ms)`);
  console.log(`prompt : ${response.prompt}`);
  console.log(`intents: ${response.intents.join(', ') || '(none)'}${response.dryRun ? ' [dry-run]' : ''}\n`);
  if (response.results.length === 0) {
    console.log('(no agents executed — see routing above)\n');
    return;
  }
  for (const r of response.results) {
    const icon = r.success ? '✔' : '✘';
    console.log(`${icon} [${r.agent}/${r.intent}] ${r.summary} (${r.durationMs}ms)`);
  }
  console.log('');
}

async function handlePrompt(prompt: string | undefined, raw: RawCliOptions, ctx: CliContext): Promise<void> {
  const options = normalizeOptions(raw);
  if (prompt === undefined || prompt.trim().length === 0) {
    throw new CliValidationError('Missing <prompt>. Provide a natural-language task, e.g. helix "audit auth for injection flaws" --secure.');
  }
  const traceId = randomUUID();
  // Per-request child logger: avoids mixing the bootstrap traceId
  // with the request traceId and keeps verbose scoped to this call.
  const log: winston.Logger = typeof ctx.logger.child === 'function' ? ctx.logger.child({ traceId }) : ctx.logger;
  if (options.verbose) {
    log.level = 'debug';
  }
  const payload: AgentPayload = {
    prompt: prompt.trim(),
    intents: intentsFromOptions(options),
    traceId,
    options,
  };
  log.info('Received CLI task', { prompt: payload.prompt, options });

  if (options.dryRun) {
    const decision = await ctx.orchestrator.route(payload);
    renderResponse(
      { traceId, prompt: payload.prompt, intents: decision.intents, dryRun: true, results: [], durationMs: 0 },
      options,
    );
    return;
  }

  const response = await ctx.orchestrator.dispatch(payload);
  renderResponse(response, options);
  if (response.results.some((r) => !r.success)) {
    process.exitCode = 3;
  }
}

/**
 * Build the commander program. Pure routing layer:
 * parses input, normalizes options, delegates to orchestrator.
 */
export function buildProgram(ctx: CliContext): Command {
  const program = new Command();
  program
    .name('helix')
    .description('HELIX — AI-powered multi-agent software development assistant')
    .version('0.1.0', '-V, --version', 'output the version number')
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  helix "refactor login handler" --analyze\n' +
        '  helix "audit auth for injection flaws" --secure --json\n' +
        '  helix secure "scan api for XSS"\n' +
        '  helix run agents --analyze   # "agents" treated as prompt, not subcommand\n' +
        '  helix -- agents               # "--" also disambiguates prompt text\n',
    );

  const rootAction = async (promptParts: string[], _opts: unknown, cmd: Command): Promise<void> => {
    const prompt = (promptParts ?? []).join(' ');
    await handlePrompt(prompt, cmd.opts<RawCliOptions>(), ctx);
  };

  // Default: natural-language prompt + operational flags.
  // Options are attached before the action for predictable help/parse order.
  const root = program.argument('[prompt...]', 'natural-language task, e.g. "refactor login handler and scan for XSS"');
  sharedOptions(root);
  root.action(rootAction);

  // Explicit `run` escape hatch: `helix run agents` treats "agents"
  // as prompt text instead of the `agents` subcommand.
  const run = program.command('run').description('run a natural-language task (escape hatch for prompts colliding with subcommand names)');
  run.argument('[prompt...]', 'natural-language task details');
  sharedOptions(run);
  run.action(async (promptParts: string[], _opts: unknown, cmd: Command) => {
    const raw = mergeRawOptions(program.opts<RawCliOptions>(), cmd.opts<RawCliOptions>());
    await handlePrompt((promptParts ?? []).join(' '), raw, ctx);
  });

  // Explicit subcommands (same flags; force the matching intent).
  const mk = (name: string, desc: string, intent: AgentIntent): void => {
    const sub = program.command(name).description(desc);
    sub.argument('[prompt...]', 'natural-language task details');
    sharedOptions(sub);
    sub.action(async (promptParts: string[], _opts: unknown, cmd: Command) => {
      const raw = mergeRawOptions(program.opts<RawCliOptions>(), cmd.opts<RawCliOptions>());
      if (intent === 'analyze') raw.analyze = true;
      if (intent === 'secure') raw.secure = true;
      if (intent === 'monitor') raw.monitor = true;
      await handlePrompt((promptParts ?? []).join(' '), raw, ctx);
    });
  };
  mk('analyze', 'run CodeAgent on a natural-language task', 'analyze');
  mk('secure', 'run SecurityAgent on a natural-language task', 'secure');
  mk('monitor', 'run EnvironmentAgent on a natural-language task', 'monitor');

  program
    .command('agents')
    .description('list registered sub-agents')
    .action(() => {
      for (const line of ctx.orchestrator.listAgents()) console.log(`- ${line}`);
    });

  return program;
}
