"use strict";
/**
 * Environment / infrastructure monitoring agent.
 *
 * Probes the local development environment via read-only commands:
 * Docker, Git, OS processes, listening ports, and system metrics.
 * Each probe is isolated; one failing probe never suppresses the others.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnvironmentAgent = void 0;
const BaseAgent_js_1 = require("../base/BaseAgent.js");
const report_js_1 = require("../report.js");
const systemInfo_js_1 = require("./probes/systemInfo.js");
const docker_js_1 = require("./probes/docker.js");
const git_js_1 = require("./probes/git.js");
const processes_js_1 = require("./probes/processes.js");
const ports_js_1 = require("./probes/ports.js");
class EnvironmentAgent extends BaseAgent_js_1.BaseAgent {
    name = 'EnvironmentAgent';
    intent = 'monitor';
    async run(payload) {
        const report = (0, report_js_1.emptyReport)(this.name, this.intent);
        const rootPath = process.cwd();
        const probeResults = await Promise.allSettled([
            Promise.resolve((0, systemInfo_js_1.probeSystemInfo)(report)),
            (0, docker_js_1.probeDocker)(report),
            (0, git_js_1.probeGit)(report, rootPath),
            (0, processes_js_1.probeProcesses)(report),
            (0, ports_js_1.probePorts)(report),
        ]);
        const failures = [];
        for (const result of probeResults) {
            if (result.status === 'rejected') {
                const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
                failures.push(reason);
            }
        }
        if (failures.length > 0) {
            report.issues.push({
                id: `${this.name}:probe-failures`,
                ruleId: 'probe-failures',
                title: `${failures.length} environment probe(s) failed`,
                message: failures.join('; '),
                severity: 'low',
                category: 'environment',
                evidence: failures.join('\n'),
            });
            report.counts.low += 1;
        }
        (0, report_js_1.attachRawEvidence)(report, { rootPath, toolsUnavailable: report.toolsUnavailable }, payload.options.verbose);
        return {
            success: true,
            summary: (0, report_js_1.formatSummary)(report),
            data: report,
        };
    }
}
exports.EnvironmentAgent = EnvironmentAgent;
