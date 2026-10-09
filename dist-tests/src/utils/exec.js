"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.execCommand = execCommand;
exports.isCommandAvailable = isCommandAvailable;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024; // 16 MB for large JSON reports
/** Best-effort extraction of the first non-empty line. */
function firstLine(message, maxChars = 200) {
    const line = message
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0);
    if (line === undefined)
        return 'unknown error';
    return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
}
/** Detect `ENOENT` regardless of error shape. */
function isEnoent(err) {
    if (err === null || typeof err !== 'object')
        return false;
    return err.code === 'ENOENT';
}
/**
 * Execute a command safely.
 *
 * @returns a discriminated union; callers handle `ok === false` instead of catching.
 */
async function execCommand(command, options = {}) {
    const args = options.args ?? [];
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const execOpts = {
        cwd: options.cwd,
        timeout,
        maxBuffer,
        windowsHide: true,
        env: options.env,
    };
    function stringifyOutput(value) {
        return Buffer.isBuffer(value) ? value.toString('utf8') : value;
    }
    try {
        const { stdout, stderr } = await execFileAsync(command, args, execOpts);
        return { ok: true, stdout: stringifyOutput(stdout), stderr: stringifyOutput(stderr), exitCode: 0 };
    }
    catch (err) {
        if (isEnoent(err)) {
            return {
                ok: false,
                kind: 'not-found',
                command,
                message: `${command}: command not found`,
            };
        }
        if (err !== null && typeof err === 'object') {
            const execErr = err;
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
async function isCommandAvailable(command) {
    const result = await execCommand(command, { args: ['--version'], timeoutMs: 5_000 });
    return result.ok;
}
