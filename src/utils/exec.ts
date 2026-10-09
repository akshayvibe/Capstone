/**
 * Shared safe command execution helper.
 *
 * Single-responsibility: wrap `child_process.execFile` in a typed,
 * never-throws-on-expected-failure envelope that the Security and
 * Environment agents can pattern-match on.
 *
 * Security invariant: only `execFile` with a fixed argv array is used;
 * no shell interpolation surface is exposed.
 */

import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024; // 16 MB for large JSON reports

export interface ExecSuccess {
  readonly ok: true;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface ExecNotFound {
  readonly ok: false;
  readonly kind: 'not-found';
  readonly command: string;
  readonly message: string;
  readonly exitCode?: undefined;
}

export interface ExecTimeout {
  readonly ok: false;
  readonly kind: 'timeout';
  readonly command: string;
  readonly elapsedMs: number;
  readonly message: string;
  readonly exitCode?: undefined;
}

export interface ExecKilled {
  readonly ok: false;
  readonly kind: 'killed';
  readonly command: string;
  readonly signal: string;
  readonly message: string;
  readonly exitCode?: undefined;
}

export interface ExecSpawnError {
  readonly ok: false;
  readonly kind: 'spawn-error';
  readonly command: string;
  readonly message: string;
  readonly exitCode?: undefined;
}

export interface ExecExitError {
  readonly ok: false;
  readonly kind: 'exit-error';
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly message: string;
}

export type ExecResult =
  | ExecSuccess
  | ExecNotFound
  | ExecTimeout
  | ExecKilled
  | ExecSpawnError
  | ExecExitError;

export interface ExecOptions {
  /** Additional fixed args appended after the command. */
  args?: readonly string[] | undefined;
  /** Working directory for the child process. */
  cwd?: string | undefined;
  /** Hard timeout in milliseconds. */
  timeoutMs?: number | undefined;
  /** Max stdout/stderr bytes. */
  maxBuffer?: number | undefined;
  /** Environment variables. */
  env?: NodeJS.ProcessEnv | undefined;
  /** Treat these non-zero exit codes as success (e.g. semgrep exits 1 on findings). */
  permitNonZeroExit?: readonly number[] | undefined;
}

/** Best-effort extraction of the first non-empty line. */
function firstLine(message: string, maxChars = 200): string {
  const line = message
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (line === undefined) return 'unknown error';
  return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
}

/** Detect `ENOENT` regardless of error shape. */
function isEnoent(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Execute a command safely.
 *
 * @returns a discriminated union; callers handle `ok === false` instead of catching.
 */
export async function execCommand(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  const args = options.args ?? [];
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;

  const execOpts: ExecFileOptions = {
    cwd: options.cwd,
    timeout,
    maxBuffer,
    windowsHide: true,
    env: options.env,
  };

  function stringifyOutput(value: string | Buffer): string {
    return Buffer.isBuffer(value) ? value.toString('utf8') : value;
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, args, execOpts);
    return { ok: true, stdout: stringifyOutput(stdout), stderr: stringifyOutput(stderr), exitCode: 0 };
  } catch (err: unknown) {
    if (isEnoent(err)) {
      return {
        ok: false,
        kind: 'not-found',
        command,
        message: `${command}: command not found`,
      };
    }

    if (err !== null && typeof err === 'object') {
      const execErr = err as {
        killed?: boolean;
        signal?: string;
        code?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
        cmd?: string;
      };

      if (execErr.killed === true) {
        return {
          ok: false,
          kind: 'killed',
          command,
          signal: execErr.signal ?? 'unknown',
          message: `${command} was killed (${execErr.signal ?? 'unknown signal'})`,
        };
      }

      if (typeof execErr.code === 'number') {
        if (options.permitNonZeroExit?.includes(execErr.code)) {
          return {
            ok: true,
            stdout: stringifyOutput(execErr.stdout ?? ''),
            stderr: stringifyOutput(execErr.stderr ?? ''),
            exitCode: execErr.code,
          };
        }
        const stderrText = stringifyOutput(execErr.stderr ?? '');
        return {
          ok: false,
          kind: 'exit-error',
          command,
          exitCode: execErr.code,
          stdout: stringifyOutput(execErr.stdout ?? ''),
          stderr: stderrText,
          message: `${command} exited with code ${execErr.code}: ${firstLine(stderrText.length > 0 ? stderrText : String(execErr.message ?? ''))}`,
        };
      }
    }

    return {
      ok: false,
      kind: 'spawn-error',
      command,
      message: `${command} could not be started: ${firstLine(err instanceof Error ? err.message : String(err))}`,
    };
  }
}

/** Convenience: true when the command exists and is executable. */
export async function isCommandAvailable(command: string): Promise<boolean> {
  const result = await execCommand(command, { args: ['--version'], timeoutMs: 5_000 });
  return result.ok;
}
