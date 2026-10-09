/**
 * Listening ports probe.
 *
 * Uses `lsof` on macOS/Linux and `netstat` on Windows. Maps listening
 * sockets to process names so users can see what services are active.
 */

import os from 'node:os';
import type { AgentReport } from '../../../../types/index.js';
import { addIssue, addToolUnavailable } from '../../report.js';
import { execCommand } from '../../../../utils/exec.js';

const PORT_TIMEOUT_MS = 8_000;

interface PortListener {
  readonly command: string;
  readonly pid: string;
  readonly protocol: string;
  readonly localAddress: string;
  readonly port: number;
}

export async function probePorts(report: AgentReport): Promise<void> {
  const platform = os.platform();

  if (platform === 'win32') {
    await probeWindows(report);
  } else {
    await probePosix(report);
  }
}

async function probePosix(report: AgentReport): Promise<void> {
  const result = await execCommand('lsof', {
    args: ['-nP', '-iTCP', '-sTCP:LISTEN'],
    timeoutMs: PORT_TIMEOUT_MS,
  });

  if (!result.ok) {
    // Fall back to netstat if lsof is unavailable.
    const netstat = await execCommand('netstat', {
      args: ['-anv', '-p', 'tcp'],
      timeoutMs: PORT_TIMEOUT_MS,
    });
    if (!netstat.ok) {
      addToolUnavailable(report, 'lsof/netstat', `lsof: ${result.message}; netstat: ${netstat.message}`);
      return;
    }
    parseNetstatOutput(report, netstat.stdout);
    return;
  }

  parseLsofOutput(report, result.stdout);
}

async function probeWindows(report: AgentReport): Promise<void> {
  const result = await execCommand('netstat', {
    args: ['-ano'],
    timeoutMs: PORT_TIMEOUT_MS,
  });

  if (!result.ok) {
    addToolUnavailable(report, 'netstat', result.message);
    return;
  }

  parseNetstatOutput(report, result.stdout);
}

function parseLsofOutput(report: AgentReport, stdout: string): void {
  const listeners: PortListener[] = [];
  const lines = stdout.trim().split('\n');
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i]?.trim().split(/\s+/);
    if (parts === undefined || parts.length < 9) continue;
    const [command, pid, , , , protocol, , localAddress] = parts;
    const port = extractPort(localAddress ?? '');
    if (port === undefined) continue;
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

function parseNetstatOutput(report: AgentReport, stdout: string): void {
  const listeners: PortListener[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!/LISTENING|ESTABLISHED|\*\.\d+|0\.0\.0\.0:\d+|:::\d+/i.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    // Format varies; try to grab a local address and pid.
    const local = parts.find((p) => /\d+\.\d+\.\d+\.\d+:\d+|:::\d+|\*\.\d+/i.test(p));
    const pid = [...parts].reverse().find((p): p is string => /^\d+$/.test(p));
    if (local === undefined) continue;
    const port = extractPort(local);
    if (port === undefined) continue;
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

function extractPort(address: string): number | undefined {
  const match = /:(\d+)$/.exec(address);
  if (match === null) return undefined;
  const rawPort = match[1];
  if (rawPort === undefined) return undefined;
  const port = parseInt(rawPort, 10);
  return Number.isFinite(port) ? port : undefined;
}

function emitListeners(report: AgentReport, listeners: PortListener[]): void {
  if (listeners.length === 0) {
    addIssue(report, {
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
    addIssue(report, {
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
