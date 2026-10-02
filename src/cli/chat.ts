/**
 * Interactive HELIX REPL (`helix chat`).
 *
 * Thin loop only (SRP): reads lines, splits slash-commands from tasks,
 * and delegates to `IOrchestratorAgent.dispatch()` — the same entrypoint
 * the one-shot CLI uses, so routing, RAG context, and timeouts behave
 * identically. Errors are printed and the loop continues; only `/exit`
 * (Ctrl+C / Ctrl+D) ends the session.
 *
 * Line syntax:
 * - `audit auth for XSS --secure` — task with inline intent flags
 *   (`--analyze/-a`, `--secure/-s`, `--monitor/-m`).
 * - `/agents`, `/index [path]`, `/json`, `/help`, `/exit`.
 */
import { randomUUID } from 'node:crypto';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import type winston from 'winston';
import type { AgentIntent, AgentPayload, CliOptions } from '../types/index.js';
import { intentsFromOptions } from './options.js';
import { DEFAULT_TIMEOUT_MS } from './options.js';
import { renderResponse } from './render.js';
import type { CliContext } from './program.js';

export interface ChatOptions {
  initialPrompt?: string | undefined;
  json?: boolean | undefined;
  timeoutMs?: number | undefined;
}

interface ChatState {
  json: boolean;
  timeoutMs: number;
}

type ChatAction =
  | { kind: 'empty' }
  | { kind: 'task'; prompt: string; intents: AgentIntent[] }
  | { kind: 'command'; name: string; arg: string };

const INTENT_FLAGS: Record<string, AgentIntent> = {
  '--analyze': 'analyze',
  '-a': 'analyze',
  '--secure': 'secure',
  '-s': 'secure',
  '--monitor': 'monitor',
  '-m': 'monitor',
};

/** Split one input line into an empty/task/command action. */
function parseLine(line: string): ChatAction {
  const trimmed = line.trim();
  if (trimmed.length === 0) return { kind: 'empty' };
  if (trimmed.startsWith('/')) {
    const space = trimmed.indexOf(' ');
    if (space === -1) return { kind: 'command', name: trimmed.slice(1).toLowerCase(), arg: '' };
    return { kind: 'command', name: trimmed.slice(1, space).toLowerCase(), arg: trimmed.slice(space + 1).trim() };
  }
  const intents: AgentIntent[] = [];
  const words = trimmed.split(/\s+/).filter((w) => {
    const intent = INTENT_FLAGS[w];
    if (intent === undefined) return true;
    if (!intents.includes(intent)) intents.push(intent);
    return false;
  });
  const prompt = words.join(' ').trim();
  if (prompt.length === 0) return { kind: 'empty' };
  return { kind: 'task', prompt, intents };
}

function printHelp(): void {
  console.log('Chat commands:');
  console.log('  <task> [--analyze|--secure|--monitor]  send a task (flags force routing)');
  console.log('  /agents                                 list registered sub-agents');
  console.log('  /index [path]                           (re)index project files for RAG');
  console.log('  /json                                   toggle JSON output');
  console.log('  /help                                   show this help');
  console.log('  /exit                                   quit (Ctrl+C / Ctrl+D also quit)');
}

/** Execute one slash-command. Returns 'exit' when the session should end. */
async function runCommand(ctx: CliContext, name: string, arg: string, state: ChatState): Promise<'exit' | 'continue'> {
  switch (name) {
    case 'help':
      printHelp();
      return 'continue';
    case 'exit':
    case 'quit':
      return 'exit';
    case 'agents':
      for (const line of ctx.orchestrator.listAgents()) console.log(`- ${line}`);
      return 'continue';
    case 'json':
      state.json = !state.json;
      console.log(`JSON output ${state.json ? 'on' : 'off'}.`);
      return 'continue';
    case 'index': {
      if (ctx.indexer === undefined) {
        console.log('RAG indexer is not wired in this session.');
        return 'continue';
      }
      console.log(`Indexing ${arg.length > 0 ? arg : 'project root'}…`);
      try {
        const stats = arg.length > 0 ? await ctx.indexer.indexProject(arg) : await ctx.indexer.indexProject();
        console.log(
          `Indexed ${stats.filesIndexed}/${stats.filesScanned} files, ${stats.chunksUpserted} chunks → "${stats.collection}"${stats.fallbackMode ? ' (in-memory fallback)' : ''}.`,
        );
      } catch (err: unknown) {
        console.error(`Indexing failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return 'continue';
    }
    default:
      console.log(`Unknown command "/${name}". Try /help.`);
      return 'continue';
  }
}

/** Dispatch one task line through the orchestrator and render the result. */
async function runTask(ctx: CliContext, prompt: string, intents: AgentIntent[], state: ChatState): Promise<void> {
  const traceId = randomUUID();
  // Per-request child logger, mirroring the one-shot path in program.ts.
  const log: winston.Logger = typeof ctx.logger.child === 'function' ? ctx.logger.child({ traceId }) : ctx.logger;
  const options: CliOptions = {
    analyze: intents.includes('analyze'),
    secure: intents.includes('secure'),
    monitor: intents.includes('monitor'),
    verbose: false,
    json: state.json,
    dryRun: false,
    timeoutMs: state.timeoutMs,
  };
  const payload: AgentPayload = { prompt, intents: intentsFromOptions(options), traceId, options };
  log.info('Received chat task', { prompt });
  try {
    const response = await ctx.orchestrator.dispatch(payload);
    renderResponse(response, options);
    if (response.results.some((r) => !r.success)) {
      console.log('(one or more agents reported failure — see above)');
    }
  } catch (err: unknown) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Run the interactive loop. Resolves when the user quits; never rejects
 * on task-level failures (they are printed inline instead).
 *
 * Chat quiets the shared logger to warnings so per-request info traces
 * don't interleave with the prompt — unless `LOG_LEVEL` is set explicitly,
 * in which case the user's choice wins.
 */
export async function runChatLoop(ctx: CliContext, opts: ChatOptions = {}): Promise<void> {
  if (process.env['LOG_LEVEL'] === undefined) {
    ctx.logger.level = 'warn';
  }
  const state: ChatState = {
    json: opts.json ?? false,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  const interactive = output.isTTY === true;
  const rl = interactive
    ? createInterface({ input, output, prompt: 'helix> ' })
    : createInterface({ input, output, terminal: false });
  // Graceful Ctrl+C: end the session instead of killing the process.
  rl.on('SIGINT', () => {
    rl.close();
  });

  console.log('HELIX interactive mode. Type a task and press Enter.');
  console.log('Slash commands: /help /agents /index [path] /json /exit');

  const first = opts.initialPrompt?.trim() ?? '';
  if (first.length > 0) {
    await runTask(ctx, first, [], state);
  }
  if (interactive) rl.prompt();
  try {
    for await (const line of rl) {
      const action = parseLine(line);
      if (action.kind === 'empty') {
        if (interactive) rl.prompt();
        continue;
      }
      if (action.kind === 'command') {
        if ((await runCommand(ctx, action.name, action.arg, state)) === 'exit') break;
      } else {
        await runTask(ctx, action.prompt, action.intents, state);
      }
      if (interactive) rl.prompt();
    }
  } finally {
    rl.close();
  }
  console.log('Goodbye.');
}
