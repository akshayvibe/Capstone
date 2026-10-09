"use strict";
/**
 * Docker environment probe.
 *
 * Uses `docker info` and `docker ps` with fixed argv (no shell),
 * parsing NDJSON lines when the Docker CLI supports `--format json`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeDocker = probeDocker;
const report_js_1 = require("../../report.js");
const exec_js_1 = require("../../../../utils/exec.js");
const DOCKER_TIMEOUT_MS = 10_000;
async function probeDocker(report) {
    const infoResult = await (0, exec_js_1.execCommand)('docker', {
        args: ['info', '--format', 'json'],
        timeoutMs: DOCKER_TIMEOUT_MS,
    });
    if (!infoResult.ok) {
        (0, report_js_1.addToolUnavailable)(report, 'docker', infoResult.message);
        return;
    }
    (0, report_js_1.addIssue)(report, {
        id: `${report.agent}:docker:daemon`,
        ruleId: 'docker-daemon',
        title: 'Docker daemon is reachable',
        message: 'Docker CLI responded to `docker info`.',
        severity: 'info',
        category: 'environment',
        evidence: 'docker info succeeded',
    });
    const psResult = await (0, exec_js_1.execCommand)('docker', {
        args: ['ps', '--format', 'json'],
        timeoutMs: DOCKER_TIMEOUT_MS,
    });
    if (!psResult.ok) {
        (0, report_js_1.addIssue)(report, {
            id: `${report.agent}:docker:ps-failed`,
            ruleId: 'docker-ps-failed',
            title: 'Could not list Docker containers',
            message: psResult.message,
            severity: 'info',
            category: 'environment',
            evidence: psResult.message,
        });
        return;
    }
    const containers = parseContainerLines(psResult.stdout);
    if (containers.length === 0) {
        (0, report_js_1.addIssue)(report, {
            id: `${report.agent}:docker:no-containers`,
            ruleId: 'docker-no-containers',
            title: 'No running Docker containers',
            message: '`docker ps` returned an empty list.',
            severity: 'info',
            category: 'environment',
            evidence: 'docker ps stdout was empty',
        });
        return;
    }
    for (const container of containers) {
        const unhealthy = /unhealthy|restarting|dead/i.test(container.status);
        (0, report_js_1.addIssue)(report, {
            id: `${report.agent}:docker:container:${container.name}`,
            ruleId: 'docker-container',
            title: `Container ${container.name}`,
            message: `${container.name} running image ${container.image} — ${container.status}`,
            severity: unhealthy ? 'medium' : 'info',
            category: 'environment',
            evidence: `name=${container.name} image=${container.image} status=${container.status}`,
            metadata: { image: container.image, status: container.status, state: container.state },
        });
    }
}
function parseContainerLines(stdout) {
    const containers = [];
    for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0)
            continue;
        // Newer Docker CLIs emit one JSON object per line.
        if (trimmed.startsWith('{')) {
            try {
                const parsed = JSON.parse(trimmed);
                const name = String(parsed['Names'] ?? parsed['Name'] ?? '');
                const image = String(parsed['Image'] ?? '');
                const status = String(parsed['Status'] ?? '');
                const state = String(parsed['State'] ?? '');
                if (name.length > 0) {
                    containers.push({ name, image, status, state });
                }
                continue;
            }
            catch {
                // Fall through to legacy tab parsing.
            }
        }
        // Legacy fallback: Names\tImage\tStatus.
        const parts = trimmed.split('\t').map((p) => p.trim());
        const [name = '', image = '', status = ''] = parts;
        if (name.length > 0) {
            containers.push({ name, image, status, state: '' });
        }
    }
    return containers;
}
