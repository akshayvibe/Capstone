/**
 * Full-screen terminal UI (`helix ui`).
 *
 * Dependency-free TUI on the alternate screen buffer: header with live
 * status, scrollable message viewport, single-line composer with history,
 * and modal overlays (help, agents). Same orchestrator entrypoint as the
 * one-shot CLI and the `chat` REPL, so routing, RAG, and timeouts behave
 * identically.
 *
 * Key bindings (also listed in the in-app `/help` overlay):
 * - Enter: send (empty input jumps to latest) · Esc: clear input / close overlay
 * - ↑/↓: input history · ←/→, Ctrl+A/E: cursor · Ctrl+W/U/K: delete word/line
 * - PgUp/PgDn (or Ctrl+↑/↓): scroll messages · Tab: complete `/command`
 * - Ctrl+C: clear input, again to quit (disabled while a request runs)
 * - Ctrl+D: quit when input is empty · Ctrl+L: redraw
 *
 * Non-TTY use is rejected with a validation error (use `helix chat` for
 * piped input). `renderFrame` is pure and unit-testable.
 */
import { randomUUID } from 'node:crypto';
import type winston from 'winston';
import type { AgentIntent, AgentPayload, CliOptions } from '../../types/index.js';
import { CliValidationError } from '../../utils/errors.js';
import { DEFAULT_TIMEOUT_MS } from '../options.js';
import { parseLine } from '../chat.js';
import type { CliContext } from '../program.js';
import {
  ALT_ENTER,
  ALT_EXIT,
  BLUE,
  BOLD,
  CLEAR_LINE,
  CYAN,
  DIM,
  GRAY,
  GREEN,
  HIDE_CURSOR,
  RED,
  RESET,
  SHOW_CURSOR,
  YELLOW,
  moveTo,
  spinnerAt,
} from './ansi.js';
import { fit, wrapLine } from './text.js';
import { parseKeys } from './keys.js';
import type { Key } from './keys.js';

export type TuiMode = 'auto' | AgentIntent;
export type TuiOverlay = 'help' | 'agents' | null;

export interface TuiUserMsg {
  kind: 'user';
  text: string;
}
export interface TuiInfoMsg {
  kind: 'info';
  text: string;
}
export interface TuiErrorMsg {
  kind: 'error';
  text: string;
}
export interface TuiResultMsg {
  kind: 'result';
  agent: string;
  intent: AgentIntent;
  success: boolean;
  summary: string;
  durationMs: number;
  traceShort: string;
  contextFiles: string[];
  contextCount: number;
}
export type TuiMsg = TuiUserMsg | TuiInfoMsg | TuiErrorMsg | TuiResultMsg;

export interface TuiState {
  width: number;
  height: number;
  messages: TuiMsg[];
  /** Composer buffer as code points (cursor math stays correct on unicode). */
  input: string[];
  cursor: number;
  history: string[];
  /** history.length = editing current draft; otherwise browsing history. */
  histIdx: number;
  draft: string[];
  scroll: number; // lines scrolled up from the bottom (0 = follow)
  pending: boolean;
  pendingLabel: string;
  pendingSince: number;
  mode: TuiMode;
  overlay: TuiOverlay;
  agentsCache: string[];
}

const MAX_MESSAGES = 200;
const SLASH_COMMANDS = ['/agents', '/index', '/mode', '/help', '/exit'];

/** Fresh state; width/height are synced to the terminal on start/resize. */
export function createState(agentsCache: string[] = []): TuiState {
  return {
    width: 80,
    height: 24,
    messages: [],
    input: [],
    cursor: 0,
    history: [],
    histIdx: 0,
    draft: [],
    scroll: 0,
    pending: false,
    pendingLabel: '',
    pendingSince: 0,
    mode: 'auto',
    overlay: null,
    agentsCache,
  };
}

function intentColor(intent: AgentIntent): string {
  if (intent === 'secure') return YELLOW;
  if (intent === 'monitor') return GREEN;
  return BLUE;
}

interface StyledLine {
  text: string;
  style: string;
}

function messageLines(m: TuiMsg, width: number): StyledLine[] {
  const out: StyledLine[] = [];
  if (m.kind === 'user') {
    const wrapped = wrapLine(m.text, width - 2);
    wrapped.forEach((line, i) => {
      out.push({ text: `${i === 0 ? '› ' : '  '}${line}`, style: `${BOLD}${CYAN}` });
    });
    return out;
  }
  if (m.kind === 'info') {
    for (const line of wrapLine(m.text, width - 2)) out.push({ text: `· ${line}`, style: GRAY });
    return out;
  }
  if (m.kind === 'error') {
    for (const line of wrapLine(m.text, width - 2)) out.push({ text: `✘ ${line}`, style: RED });
    return out;
  }
  // result
  const icon = m.success ? '✔' : '✘';
  const headStyle = m.success ? GREEN : RED;
  out.push({
    text: `${icon} ${m.agent} · ${m.intent} · ${m.durationMs}ms · ${m.traceShort}`,
    style: `${BOLD}${headStyle}`,
  });
  const intentStyle = intentColor(m.intent);
  for (const line of wrapLine(m.summary, width - 2)) out.push({ text: `  ${line}`, style: intentStyle });
  if (m.contextCount > 0) {
    const files = m.contextFiles.length > 0 ? m.contextFiles.join(', ') : `${m.contextCount} chunks`;
    for (const line of wrapLine(`└ context (${m.contextCount}): ${files}`, width - 2)) {
      out.push({ text: `  ${line}`, style: `${DIM}${GRAY}` });
    }
  }
  return out;
}

function pushMessage(s: TuiState, m: TuiMsg): void {
  s.messages.push(m);
  if (s.messages.length > MAX_MESSAGES) {
    s.messages.splice(0, s.messages.length - MAX_MESSAGES);
  }
}

/** Draw a centered modal box over the frame lines. */
function applyOverlay(frame: string[], title: string, body: string[]): void {
  const h = frame.length;
  if (h === 0) return;
  const w = Math.max(...frame.map((l) => stripLength(l)), 0);
  const bw = Math.min(w - 4, Math.max(30, ...body.map((l) => l.length + 4), title.length + 6));
  const bh = body.length + 4;
  const top = Math.max(0, Math.floor((h - bh) / 2));
  const left = Math.max(0, Math.floor((w - bw) / 2));
  const bar = '─'.repeat(Math.max(0, bw - 2));
  const box: string[] = [`┌${bar}┐`, `│ ${fit(title, bw - 4)} │`, `├${bar}┤`];
  for (const line of body) box.push(`│ ${fit(line, bw - 4)} │`);
  box.push(`└${bar}┘`);
  for (let r = 0; r < box.length && top + r < h; r += 1) {
    const base = (frame[top + r] ?? '').padEnd(left + bw, ' ');
    frame[top + r] = `${base.slice(0, left)}${box[r] ?? ''}${base.slice(left + bw)}`;
  }
}

/** Visible length ignoring ANSI escapes (frame lines carry styling). */
function stripLength(line: string): number {
  return line.replace(/\x1b\[[0-9;]*m/g, '').length;
}

const HELP_BODY = [
  'Enter           send (empty input jumps to latest)',
  'Esc             clear input · close overlay',
  '↑ / ↓           input history',
  '← / → · ^A /^E  move cursor · ^W ^U ^K edit',
  'PgUp / PgDn     scroll messages (Ctrl+↑/↓ too)',
  'Tab             complete /command',
  '^C              clear, again to quit · ^D quit · ^L redraw',
  '',
  '/agents · /index [path] · /mode <auto|…> · /help · /exit',
];

/**
 * Render one full frame (pure function of state + clock). Returns the raw
 * bytes to write: cursor-home, styled lines with per-line clearing, and
 * final cursor placement on the composer.
 */
export function renderFrame(s: TuiState, nowMs: number): string {
  const w = Math.max(20, Math.floor(s.width));
  const h = Math.max(10, Math.floor(s.height));
  if (w < 50 || h < 12) {
    return `${moveTo(1, 1)}${CLEAR_LINE}Terminal too small for the HELIX UI (need 50×12).${moveTo(2, 1)}${CLEAR_LINE}Resize, or use \`helix chat\` instead.`;
  }

  // Header (visible math must match the styled output exactly).
  const elapsed = Math.max(0, Math.floor((nowMs - s.pendingSince) / 1000));
  const modeText = `mode:${s.mode}`;
  const statusPlain = s.pending ? `${spinnerAt(nowMs)} Working ${elapsed}s` : '● Ready';
  const statusStyled = s.pending ? `${YELLOW}${statusPlain}${RESET}` : `${GREEN}${statusPlain}${RESET}`;
  const gap = Math.max(1, w - ' HELIX  '.length - statusPlain.length - modeText.length);
  const headerLine = `${BOLD} HELIX ${RESET} ${statusStyled}${' '.repeat(gap)}${DIM}${modeText}${RESET}`;

  // Viewport
  const viewH = h - 4; // header + separator + composer + status
  const all: StyledLine[] = [];
  if (s.messages.length === 0 && !s.pending) {
    all.push({ text: 'Type a task and press Enter. Try: audit auth for injection flaws', style: GRAY });
    all.push({ text: 'Slash commands: /agents · /index [path] · /mode <auto|analyze|secure|monitor> · /help · /exit', style: `${DIM}${GRAY}` });
  }
  for (const m of s.messages) all.push(...messageLines(m, w));
  if (s.pending) {
    all.push({
      text: `${spinnerAt(nowMs)} ${s.pendingLabel}…`,
      style: YELLOW,
    });
  }
  const maxScroll = Math.max(0, all.length - viewH);
  const scroll = Math.min(s.scroll, maxScroll);
  const start = Math.max(0, all.length - scroll - viewH);
  const visible = all.slice(start, start + viewH);
  while (visible.length < viewH) visible.unshift({ text: '', style: '' });

  // Composer (single line, horizontal scroll to keep the cursor visible)
  const prefix = '❯ ';
  const avail = Math.max(10, w - prefix.length - 1);
  let winStart = 0;
  if (s.cursor > avail - 1) winStart = s.cursor - (avail - 1);
  const win = s.input.slice(winStart, winStart + avail).join('');
  const cursorCol = prefix.length + 1 + (s.cursor - winStart); // 1-based

  const statusBar = fit(
    ' Enter send · ↑↓ history · PgUp/PgDn scroll · Tab complete · Esc clear · ^C quit ',
    w,
  );

  const lines: string[] = [fitAnsiLine(headerLine, w)];
  for (const v of visible) lines.push(fitAnsiLine(`${v.style}${v.text}${RESET}`, w));
  lines.push(`${DIM}${'─'.repeat(w)}${RESET}`);
  lines.push(`${BOLD}${prefix}${RESET}${win}`);
  lines.push(`${DIM}${statusBar}${RESET}`);

  if (s.overlay === 'help') {
    applyOverlay(lines, 'Help', HELP_BODY);
  } else if (s.overlay === 'agents') {
    const body = s.agentsCache.length > 0 ? s.agentsCache : ['No agents registered.'];
    applyOverlay(lines, 'Agents', body);
  }

  const composerRow = h - 1; // 1-based: header(1) + viewH + sep + composer
  return `${moveTo(1, 1)}${lines.map((l) => `${l}${CLEAR_LINE}`).join('\n')}${moveTo(composerRow, Math.min(w, cursorCol))}${SHOW_CURSOR}`;
}

/** Pad/truncate a line that already contains ANSI escapes. */
function fitAnsiLine(line: string, width: number): string {
  const len = stripLength(line);
  if (len <= width) return line + ' '.repeat(width - len);
  // Truncation could split an escape — acceptable: RESET is re-appended.
  return `${truncateVisible(line, width - 1)}…`;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Truncate styled text to N visible columns, preserving escapes. */
function truncateVisible(line: string, width: number): string {
  let visible = 0;
  let out = '';
  const re = /\x1b\[[0-9;]*m|./gsu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const token = m[0] ?? '';
    if (token.startsWith('\x1b')) {
      out += token;
      continue;
    }
    if (visible >= width) break;
    out += token;
    visible += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Editing + key handling (mutates state, returns 'quit' when session ends)
// ---------------------------------------------------------------------------

function resetHistoryBrowse(s: TuiState): void {
  s.histIdx = s.history.length;
}

function insertText(s: TuiState, text: string): void {
  const chars = [...text].filter((c) => c !== '\n' && c !== '\r' && c !== '\t');
  if (chars.length === 0) return;
  s.input.splice(s.cursor, 0, ...chars);
  s.cursor += chars.length;
  resetHistoryBrowse(s);
}

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[\p{L}\p{N}_]/u.test(c);
}

function moveWordLeft(s: TuiState): void {
  let i = s.cursor;
  while (i > 0 && !isWordChar(s.input[i - 1])) i -= 1;
  while (i > 0 && isWordChar(s.input[i - 1])) i -= 1;
  s.cursor = i;
}

function moveWordRight(s: TuiState): void {
  let i = s.cursor;
  while (i < s.input.length && !isWordChar(s.input[i])) i += 1;
  while (i < s.input.length && isWordChar(s.input[i])) i += 1;
  s.cursor = i;
}

function deleteWordBack(s: TuiState): void {
  const end = s.cursor;
  moveWordLeft(s);
  s.input.splice(s.cursor, end - s.cursor);
  resetHistoryBrowse(s);
}

function browseHistory(s: TuiState, dir: -1 | 1): void {
  if (s.history.length === 0) return;
  if (dir === -1 && s.histIdx === s.history.length) {
    s.draft = [...s.input];
  }
  const next = s.histIdx + dir;
  if (next < 0 || next > s.history.length) return;
  s.histIdx = next;
  const text = next === s.history.length ? s.draft.join('') : (s.history[next] ?? '');
  s.input = [...text];
  s.cursor = s.input.length;
}

function completeSlash(s: TuiState): void {
  const current = s.input.join('');
  if (!current.startsWith('/')) return;
  const frag = current.slice(1).split(/\s+/)[0] ?? '';
  const matches = SLASH_COMMANDS.filter((c) => c.startsWith(`/${frag}`));
  if (matches.length === 1) {
    const full = matches[0] ?? '';
    const needsArg = full === '/index' || full === '/mode';
    s.input = [...`${full}${needsArg ? ' ' : ''}`];
    s.cursor = s.input.length;
  } else if (matches.length > 1) {
    // Complete the longest common prefix.
    let prefix = matches[0] ?? '';
    for (const m of matches) {
      let i = 0;
      while (i < prefix.length && prefix[i] === m[i]) i += 1;
      prefix = prefix.slice(0, i);
    }
    if (prefix.length > current.length) {
      s.input = [...prefix];
      s.cursor = s.input.length;
    }
  }
}

export type KeyOutcome = 'continue' | 'quit' | 'submit';

/** Apply one key to the state. Pure except for the returned outcome. */
export function handleKey(s: TuiState, key: Key): KeyOutcome {
  if (key.type === 'ignore') return 'continue';
  if (key.type === 'ctrl' && key.key === 'l') return 'continue'; // redraw (caller re-renders)

  // While an overlay is open, Esc (or q) closes it; other keys are swallowed.
  if (s.overlay !== null) {
    if (key.type === 'esc' || (key.type === 'text' && key.text === 'q' && s.input.length === 0)) {
      s.overlay = null;
    }
    return 'continue';
  }

  switch (key.type) {
    case 'esc':
      if (s.input.length > 0) {
        s.input = [];
        s.cursor = 0;
        resetHistoryBrowse(s);
      } else if (s.scroll > 0) {
        s.scroll = 0;
      }
      return 'continue';
    case 'enter': {
      const text = s.input.join('').trim();
      if (text.length === 0) {
        s.scroll = 0; // empty Enter re-pins to latest
        return 'continue';
      }
      return 'submit';
    }
    case 'tab':
      completeSlash(s);
      return 'continue';
    case 'backspace':
      if (s.cursor > 0) {
        s.input.splice(s.cursor - 1, 1);
        s.cursor -= 1;
        resetHistoryBrowse(s);
      }
      return 'continue';
    case 'delete':
      if (s.cursor < s.input.length) {
        s.input.splice(s.cursor, 1);
        resetHistoryBrowse(s);
      }
      return 'continue';
    case 'left':
      if (s.cursor > 0) s.cursor -= 1;
      return 'continue';
    case 'right':
      if (s.cursor < s.input.length) s.cursor += 1;
      return 'continue';
    case 'wordleft':
      moveWordLeft(s);
      return 'continue';
    case 'wordright':
      moveWordRight(s);
      return 'continue';
    case 'up':
      browseHistory(s, -1);
      return 'continue';
    case 'down':
      browseHistory(s, 1);
      return 'continue';
    case 'home':
      s.cursor = 0;
      return 'continue';
    case 'end':
      s.cursor = s.input.length;
      return 'continue';
    case 'pgup':
      s.scroll += Math.max(1, s.height - 5);
      return 'continue';
    case 'pgdn':
      s.scroll = Math.max(0, s.scroll - Math.max(1, s.height - 5));
      return 'continue';
    case 'text':
      insertText(s, key.text);
      return 'continue';
    case 'ctrl': {
      if (s.pending && (key.key === 'c' || key.key === 'd')) return 'continue'; // never quit mid-request
      switch (key.key) {
        case 'c':
          if (s.input.length > 0) {
            s.input = [];
            s.cursor = 0;
            resetHistoryBrowse(s);
            return 'continue';
          }
          return 'quit';
        case 'd':
          return s.input.length === 0 ? 'quit' : 'continue';
        case 'a':
          s.cursor = 0;
          return 'continue';
        case 'e':
          s.cursor = s.input.length;
          return 'continue';
        case 'u':
          s.input.splice(0, s.cursor);
          s.cursor = 0;
          resetHistoryBrowse(s);
          return 'continue';
        case 'k':
          s.input.splice(s.cursor);
          resetHistoryBrowse(s);
          return 'continue';
        case 'w':
          deleteWordBack(s);
          return 'continue';
        default:
          return 'continue';
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Session runtime (impure: terminal, network, orchestrator)
// ---------------------------------------------------------------------------

async function submitLine(ctx: CliContext, s: TuiState, rawLine: string): Promise<void> {
  const action = parseLine(rawLine);
  if (action.kind === 'empty') return;
  if (action.kind === 'command') {
    await runSlash(ctx, s, action.name, action.arg);
    return;
  }
  const prompt = action.prompt;
  const intents = action.intents.length > 0 ? action.intents : s.mode === 'auto' ? [] : [s.mode];
  pushHistory(s, prompt);
  pushMessage(s, { kind: 'user', text: prompt });
  s.pending = true;
  s.pendingLabel = 'Agents working';
  s.pendingSince = Date.now();

  const traceId = randomUUID();
  const log: winston.Logger = typeof ctx.logger.child === 'function' ? ctx.logger.child({ traceId }) : ctx.logger;
  const options: CliOptions = {
    analyze: intents.includes('analyze'),
    secure: intents.includes('secure'),
    monitor: intents.includes('monitor'),
    verbose: false,
    json: false,
    dryRun: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  const payload: AgentPayload = { prompt, intents, traceId, options };
  log.info('Received TUI task', { prompt });
  try {
    const response = await ctx.orchestrator.dispatch(payload);
    // Best-effort display context (warm cache after dispatch — no reindex).
    let contextFiles: string[] = [];
    let contextCount = 0;
    if (ctx.indexer !== undefined) {
      try {
        const chunks = await ctx.indexer.retrieveContext(prompt, 5);
        contextCount = chunks.length;
        contextFiles = [...new Set(chunks.map((c) => c.filePath))].slice(0, 5);
      } catch {
        // Display-only: swallow.
      }
    }
    if (response.results.length === 0) {
      pushMessage(s, { kind: 'info', text: 'No agents executed.' });
    }
    for (const r of response.results) {
      pushMessage(s, {
        kind: 'result',
        agent: r.agent,
        intent: r.intent,
        success: r.success,
        summary: r.summary,
        durationMs: r.durationMs,
        traceShort: response.traceId.slice(0, 8),
        contextFiles,
        contextCount,
      });
    }
  } catch (err: unknown) {
    pushMessage(s, { kind: 'error', text: err instanceof Error ? err.message : String(err) });
  } finally {
    s.pending = false;
  }
}

function pushHistory(s: TuiState, line: string): void {
  const last = s.history[s.history.length - 1];
  if (last !== line) s.history.push(line);
  if (s.history.length > 100) s.history.splice(0, s.history.length - 100);
  s.histIdx = s.history.length;
  s.draft = [];
}

async function runSlash(ctx: CliContext, s: TuiState, name: string, arg: string): Promise<void> {
  switch (name) {
    case 'help':
      s.overlay = 'help';
      return;
    case 'agents':
      s.overlay = 'agents';
      return;
    case 'exit':
    case 'quit':
      s.overlay = null;
      quitRequested = true;
      return;
    case 'mode': {
      const want = arg.toLowerCase();
      if (want === '') {
        pushMessage(s, { kind: 'info', text: `Routing mode: ${s.mode}.` });
      } else if (want === 'auto' || want === 'analyze' || want === 'secure' || want === 'monitor') {
        s.mode = want;
        pushMessage(s, { kind: 'info', text: `Routing mode: ${s.mode}.` });
      } else {
        pushMessage(s, { kind: 'error', text: `Usage: /mode <auto|analyze|secure|monitor>.` });
      }
      return;
    }
    case 'index': {
      if (ctx.indexer === undefined) {
        pushMessage(s, { kind: 'info', text: 'RAG indexer is not wired in this session.' });
        return;
      }
      s.pending = true;
      s.pendingLabel = `Indexing ${arg.length > 0 ? arg : 'project'}`;
      s.pendingSince = Date.now();
      try {
        const stats =
          arg.length > 0 ? await ctx.indexer.indexProject(arg) : await ctx.indexer.indexProject();
        pushMessage(s, {
          kind: 'info',
          text: `Indexed ${stats.filesIndexed}/${stats.filesScanned} files, ${stats.chunksUpserted} chunks → "${stats.collection}"${stats.fallbackMode ? ' (in-memory fallback)' : ''}.`,
        });
      } catch (err: unknown) {
        pushMessage(s, { kind: 'error', text: `Indexing failed: ${err instanceof Error ? err.message : String(err)}` });
      } finally {
        s.pending = false;
      }
      return;
    }
    default:
      pushMessage(s, { kind: 'error', text: `Unknown command "/${name}". Try /help.` });
  }
}

// Set by slash commands so the runtime can end the session.
let quitRequested = false;

/**
 * Run the full-screen TUI. Resolves on quit; restores the terminal even on
 * errors. Rejects only for non-TTY use (validation) — task failures render
 * inline instead.
 */
export async function runTui(ctx: CliContext): Promise<void> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new CliValidationError(
      'The terminal UI needs an interactive terminal (TTY). Use `helix chat` for piped input or `helix "<task>"` for one-shot runs.',
    );
  }
  if (process.env['LOG_LEVEL'] === undefined) {
    ctx.logger.level = 'warn';
  }
  quitRequested = false;
  const s = createState(ctx.orchestrator.listAgents());
  const stdin = process.stdin;
  const stdout = process.stdout;
  const syncSize = (): void => {
    s.width = stdout.columns ?? 80;
    s.height = stdout.rows ?? 24;
    s.scroll = 0;
  };
  syncSize();
  pushMessage(s, { kind: 'info', text: 'Welcome to HELIX. Type a task, or /help for keys and commands.' });

  const render = (): void => {
    stdout.write(renderFrame(s, Date.now()));
  };

  stdin.setRawMode(true);
  stdin.resume();
  stdout.write(`${ALT_ENTER}${HIDE_CURSOR}`);
  render();

  let spinner: NodeJS.Timeout | null = null;
  const ensureSpinner = (): void => {
    if (spinner === null && s.pending) {
      spinner = setInterval(render, 120);
    } else if (spinner !== null && !s.pending) {
      clearInterval(spinner);
      spinner = null;
    }
  };

  const cleanup = (): void => {
    if (spinner !== null) {
      clearInterval(spinner);
      spinner = null;
    }
    stdout.off('resize', onResize);
    stdin.off('data', onData);
    if (stdin.isTTY === true) {
      try {
        stdin.setRawMode(false);
      } catch {
        // Already restored — ignore.
      }
    }
    stdin.pause();
    stdout.write(`${ALT_EXIT}${SHOW_CURSOR}`);
  };

  const onResize = (): void => {
    syncSize();
    render();
  };

  let quitting = false;
  const finish = (): void => {
    if (!quitting) {
      quitting = true;
      cleanup();
      process.removeListener('SIGINT', onSigInt);
      process.removeListener('SIGTERM', onSigTerm);
    }
  };
  const onSigInt = (): void => {
    finish();
    process.exit(130);
  };
  const onSigTerm = (): void => {
    finish();
    process.exit(143);
  };
  process.once('SIGINT', onSigInt);
  process.once('SIGTERM', onSigTerm);
  stdout.on('resize', onResize);

  const onData = (chunk: Buffer): void => {
    if (quitting) return;
    for (const key of parseKeys(chunk.toString('utf8'))) {
      const outcome = handleKey(s, key);
      if (outcome === 'quit') {
        if (s.pending) continue; // never abandon a running request
        finish();
        resolveSession?.();
        return;
      }
      if (outcome === 'submit') {
        const line = s.input.join('');
        s.input = [];
        s.cursor = 0;
        resetHistoryBrowse(s);
        s.scroll = 0;
        void submitLine(ctx, s, line).then(() => {
          ensureSpinner();
          if (!quitting) render();
          if (quitRequested) {
            finish();
            resolveSession?.();
          }
        });
      }
      ensureSpinner();
      if (!quitting) render();
    }
  };
  stdin.on('data', onData);

  let resolveSession: (() => void) | null = null;
  await new Promise<void>((resolvePromise) => {
    resolveSession = resolvePromise;
  });
  finish();
  console.log('Goodbye.');
}
