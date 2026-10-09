"use strict";
/**
 * Local process probe.
 *
 * Uses `ps` on macOS/Linux and falls back to `tasklist` on Windows.
 * Reports top CPU and memory consumers.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeProcesses = probeProcesses;
const node_os_1 = __importDefault(require("node:os"));
const report_js_1 = require("../../report.js");
const exec_js_1 = require("../../../../utils/exec.js");
const PS_TIMEOUT_MS = 8_000;
const TOP_N = 5;
async function probeProcesses(report) {
    const platform = node_os_1.default.platform();
    if (platform === 'win32') {
        await probeWindows(report);
    }
    else {
        await probePosix(report);
    }
}
async function probePosix(report) {
    const platform = node_os_1.default.platform();
    // macOS `ps` does not accept `--sort`; use `-r` (sorted by CPU).
    // Linux accepts `--sort=-pcpu` for deterministic ordering.
    const args = platform === 'darwin'
        ? ['-eo', 'pid,pcpu,pmem,comm', '-r']
        : ['-eo', 'pid,pcpu,pmem,comm', '--sort=-pcpu'];
    const result = await (0, exec_js_1.execCommand)('ps', { args, timeoutMs: PS_TIMEOUT_MS });
    if (!result.ok) {
        (0, report_js_1.addToolUnavailable)(report, 'ps', result.message);
        return;
    }
    const samples = parsePsOutput(result.stdout);
    if (samples.length === 0) {
        (0, report_js_1.addIssue)(report, {
            id: `${report.agent}:processes:empty`,
            ruleId: 'processes-empty',
            title: 'No process samples available',
            message: '`ps` produced no parseable output.',
            severity: 'info',
            category: 'environment',
            evidence: result.stdout.slice(0, 200),
        });
        return;
    }
    emitTopConsumers(report, samples);
}
async function probeWindows(report) {
    const result = await (0, exec_js_1.execCommand)('tasklist', {
        args: ['/fo', 'csv', '/nh'],
        timeoutMs: PS_TIMEOUT_MS,
    });
    if (!result.ok) {
        (0, report_js_1.addToolUnavailable)(report, 'tasklist', result.message);
        return;
    }
    // tasklist doesn't give CPU; report memory-heavy processes as info.
    const lines = result.stdout.split('\n').slice(0, TOP_N + 1);
    for (const line of lines) {
        const cols = line.split('","').map((c) => c.replace(/^"|"$/g, ''));
        const [image = '', pid = '', , mem = ''] = cols;
        if (image.length === 0 || image.toLowerCase() === 'image name')
            continue;
        (0, report_js_1.addIssue)(report, {
            id: `${report.agent}:processes:win:${pid}`,
            ruleId: 'windows-process',
            title: `Process ${image}`,
            message: `PID ${pid} using ${mem}`,
            severity: 'info',
            category: 'environment',
            evidence: line,
            metadata: { pid, image, mem },
        });
    }
}
function parsePsOutput(stdout) {
    const lines = stdout.trim().split('\n');
    const samples = [];
    for (let i = 1; i < lines.length; i += 1) {
        const parts = lines[i]?.trim().split(/\s+/);
        if (parts === undefined || parts.length < 4)
            continue;
        const [pid, cpu, mem, ...commandParts] = parts;
        const cpuPct = parseFloat(cpu ?? '0');
        const memPct = parseFloat(mem ?? '0');
        const command = commandParts.join(' ');
        if (Number.isFinite(cpuPct) && Number.isFinite(memPct)) {
            samples.push({ pid: pid ?? '', command, cpuPct, memPct });
        }
    }
    return samples;
}
function emitTopConsumers(report, samples) {
    const byCpu = [...samples].sort((a, b) => b.cpuPct - a.cpuPct).slice(0, TOP_N);
    const byMem = [...samples].sort((a, b) => b.memPct - a.memPct).slice(0, TOP_N);
    for (const sample of byCpu) {
        (0, report_js_1.addIssue)(report, {
            id: `${report.agent}:processes:cpu:${sample.pid}`,
            ruleId: 'process-cpu',
            title: `High CPU process: ${sample.command}`,
            message: `PID ${sample.pid} is using ${sample.cpuPct.toFixed(1)}% CPU.`,
            severity: sample.cpuPct > 80 ? 'medium' : 'info',
            category: 'environment',
            evidence: `pid=${sample.pid} cpu=${sample.cpuPct.toFixed(1)} mem=${sample.memPct.toFixed(1)} command=${sample.command}`,
            metadata: { pid: sample.pid, cpuPct: sample.cpuPct, memPct: sample.memPct, command: sample.command },
        });
    }
    for (const sample of byMem) {
        (0, report_js_1.addIssue)(report, {
            id: `${report.agent}:processes:mem:${sample.pid}`,
            ruleId: 'process-mem',
            title: `High memory process: ${sample.command}`,
            message: `PID ${sample.pid} is using ${sample.memPct.toFixed(1)}% memory.`,
            severity: sample.memPct > 50 ? 'medium' : 'info',
            category: 'environment',
            evidence: `pid=${sample.pid} cpu=${sample.cpuPct.toFixed(1)} mem=${sample.memPct.toFixed(1)} command=${sample.command}`,
            metadata: { pid: sample.pid, cpuPct: sample.cpuPct, memPct: sample.memPct, command: sample.command },
        });
    }
}
