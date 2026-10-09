/**
 * Environment / infrastructure monitoring agent.
 *
 * Probes the local development environment via read-only commands:
 * Docker, Git, OS processes, listening ports, and system metrics.
 * Each probe is isolated; one failing probe never suppresses the others.
 */

import type { AgentPayload, AgentReport } from '../../../types/index.js';
import { BaseAgent } from '../base/BaseAgent.js';
import { emptyReport, attachRawEvidence, formatSummary } from '../report.js';
import { probeSystemInfo } from './probes/systemInfo.js';
import { probeDocker } from './probes/docker.js';
import { probeGit } from './probes/git.js';
import { probeProcesses } from './probes/processes.js';
import { probePorts } from './probes/ports.js';

export class EnvironmentAgent extends BaseAgent {
  public readonly name = 'EnvironmentAgent';
  public readonly intent = 'monitor' as const;

  protected async run(payload: AgentPayload): Promise<{ success: boolean; summary: string; data: AgentReport }> {
    const report = emptyReport(this.name, this.intent);
    const rootPath = process.cwd();

    const probeResults = await Promise.allSettled([
      Promise.resolve(probeSystemInfo(report)),
      probeDocker(report),
      probeGit(report, rootPath),
      probeProcesses(report),
      probePorts(report),
    ]);

    const failures: string[] = [];
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

    attachRawEvidence(
      report,
      { rootPath, toolsUnavailable: report.toolsUnavailable },
      payload.options.verbose,
    );

    return {
      success: true,
      summary: formatSummary(report),
      data: report,
    };
  }
}
