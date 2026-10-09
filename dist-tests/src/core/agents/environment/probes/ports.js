"use strict";
/**
 * Listening ports probe.
 *
 * Uses `lsof` on macOS/Linux and `netstat` on Windows. Maps listening
 * sockets to process names so users can see what services are active.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.probePorts = probePorts;
const node_os_1 = __importDefault(require("node:os"));
const report_js_1 = require("../../report.js");
const exec_js_1 = require("../../../../utils/exec.js");
const PORT_TIMEOUT_MS = 8_000;
async function probePorts(report) {
    const platform = node_os_1.default.platform();
    if (platform === 'win32') {
        await probeWindows(report);
    }
    else {
        await probePosix(report);
    }
}
async function probePosix(report) {
    const result = await (0, exec_js_1.execCommand)('lsof', {
        args: ['-nP', '-iTCP', '-sTCP:LISTEN'],
        timeoutMs: PORT_TIMEOUT_MS,
    });
    if (!result.ok) {
        // Fall back to netstat if lsof is unavailable.
        const netstat = await (0, exec_js_1.execCommand)('netstat', {
            args: ['-anv', '-p', 'tcp'],
            timeoutMs: PORT_TIMEOUT_MS,
        });
        if (!netstat.ok) {
            (0, report_js_1.addToolUnavailable)(report, 'lsof/netstat', `lsof: ${result.message}; netstat: ${netstat.message}`);
            return;
        }
        parseNetstatOutput(report, netstat.stdout);
        return;
    }
    parseLsofOutput(report, result.stdout);
}
async function probeWindows(report) {
    const result = await (0, exec_js_1.execCommand)('netstat', {
        args: ['-ano'],
        timeoutMs: PORT_TIMEOUT_MS,
    });
    if (!result.ok) {
        (0, report_js_1.addToolUnavailable)(report, 'netstat', result.message);
        return;
    }
    parseNetstatOutput(report, result.stdout);
}
function parseLsofOutput(report, stdout) {
    const listeners = [];
    const lines = stdout.trim().split('\n');
    for (let i = 1; i < lines.length; i += 1) {
        const parts = lines[i]?.trim().split(/\s+/);
        if (parts === undefined || parts.length < 9)
            continue;
        const [command, pid, , , , protocol, , localAddress] = parts;
        const port = extractPort(localAddress ?? '');
        if (port === undefined)
            continue;
        listeners.push({
            command: command ?? '',
            pid: pid ?? '',
            protocol: protocol ?? 'tcp',
            localAddress: localAddress ?? '',
            port,
        });
    }
    emitListeners(report, listeners);
}
function parseNetstatOutput(report, stdout) {
    const listeners = [];
    for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!/LISTENING|ESTABLISHED|\*\.\d+|0\.0\.0\.0:\d+|:::\d+/i.test(trimmed))
            continue;
        const parts = trimmed.split(/\s+/);
        // Format varies; try to grab a local address and pid.
        const local = parts.find((p) => /\d+\.\d+\.\d+\.\d+:\d+|:::\d+|\*\.\d+/i.test(p));
        const pid = [...parts].reverse().find((p) => /^\d+$/.test(p));
        if (local === undefined)
            continue;
        const port = extractPort(local);
        if (port === undefined)
            continue;
        listeners.push({
            command: 'unknown',
            pid: pid ?? 'unknown',
            protocol: 'tcp',
            localAddress: local,
            port,
        });
    }
    emitListeners(report, listeners);
}
function extractPort(address) {
    const match = /:(\d+)$/.exec(address);
    if (match === null)
        return undefined;
    const rawPort = match[1];
    if (rawPort === undefined)
        return undefined;
    const port = parseInt(rawPort, 10);
    return Number.isFinite(port) ? port : undefined;
}
function emitListeners(report, listeners) {
    if (listeners.length === 0) {
        (0, report_js_1.addIssue)(report, {
            id: `${report.agent}:ports:none`,
            ruleId: 'no-listeners',
            title: 'No listening TCP ports detected',
            message: 'Neither lsof nor netstat reported listening sockets.',
            severity: 'info',
            category: 'environment',
            evidence: 'empty listener list',
        });
        return;
    }
    for (const listener of listeners) {
        (0, report_js_1.addIssue)(report, {
            id: `${report.agent}:ports:${listener.port}`,
            ruleId: 'listening-port',
            title: `Port ${listener.port} listening`,
            message: `${listener.command} (PID ${listener.pid}) is listening on ${listener.localAddress}.`,
            severity: 'info',
            category: 'environment',
            evidence: `command=${listener.command} pid=${listener.pid} protocol=${listener.protocol} local=${listener.localAddress}`,
            metadata: { port: listener.port, pid: listener.pid, command: listener.command, protocol: listener.protocol },
        });
    }
}
