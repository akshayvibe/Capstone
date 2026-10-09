/**
 * Security scanning agent.
 *
 * Orchestrates semgrep (SAST), gitleaks (secret detection), and npm audit
 * (dependency risk). Each tool runs independently; missing tools are reported
 * as info issues rather than agent failures.
 */

import type { AgentPayload, AgentReport } from '../../../types/index.js';
import { BaseAgent } from '../base/BaseAgent.js';
import { emptyReport, addIssue, addToolUnavailable, attachRawEvidence, formatSummary } from '../report.js';
import { runSemgrep, mapSemgrepToIssues } from './tools/semgrep.js';
import { runGitleaks, mapGitleaksToIssues } from './tools/gitleaks.js';
import { runNpmAudit, mapNpmAuditToIssues } from './tools/npmAudit.js';

export class SecurityAgent extends BaseAgent {
  public readonly name = 'SecurityAgent';
  public readonly intent = 'secure' as const;

  protected async run(payload: AgentPayload): Promise<{ success: boolean; summary: string; data: AgentReport }> {
    const report = emptyReport(this.name, this.intent);
    const rootPath = process.cwd();

    const semgrepResult = await runSemgrep(rootPath, process.env['HELIX_SEMGREP_CONFIG']);
    if (semgrepResult.available && semgrepResult.version) {
      report.toolsUsed.push(`semgrep ${semgrepResult.version}`);
    }
    if (semgrepResult.error) {
      addToolUnavailable(report, 'semgrep', semgrepResult.error.message);
    }
    if (semgrepResult.output) {
      for (const issue of mapSemgrepToIssues(semgrepResult.output)) {
        addIssue(report, issue);
      }
      report.filesScanned += countUniqueFiles(semgrepResult.output.results.map((r) => r.path));
    }

    const gitleaksResult = await runGitleaks(rootPath);
    if (gitleaksResult.available && gitleaksResult.version) {
      report.toolsUsed.push(`gitleaks ${gitleaksResult.version}`);
    }
    if (gitleaksResult.error) {
      addToolUnavailable(report, 'gitleaks', gitleaksResult.error.message);
    }
    if (gitleaksResult.findings) {
      for (const issue of mapGitleaksToIssues(gitleaksResult.findings)) {
        addIssue(report, issue);
      }
    }

    const npmAuditResult = await runNpmAudit(rootPath);
    if (npmAuditResult.available && npmAuditResult.version) {
      report.toolsUsed.push(`npm ${npmAuditResult.version}`);
    }
    if (npmAuditResult.error) {
      // npm audit missing a lockfile is informative, not a hard failure.
      if (npmAuditResult.error.message.includes('No lockfile')) {
        addIssue(report, {
          id: `${this.name}:npm-audit:no-lockfile`,
          ruleId: 'npm-audit-no-lockfile',
          title: 'No lockfile for npm audit',
          message: npmAuditResult.error.message,
          severity: 'info',
          category: 'dependency',
          evidence: npmAuditResult.error.message,
        });
      } else {
        addToolUnavailable(report, 'npm audit', npmAuditResult.error.message);
      }
    }
    if (npmAuditResult.output) {
      for (const issue of mapNpmAuditToIssues(npmAuditResult.output)) {
        addIssue(report, issue);
      }
    }

    attachRawEvidence(
      report,
      {
        semgrepErrors: semgrepResult.output?.errors,
        toolsUnavailable: report.toolsUnavailable,
      },
      payload.options.verbose,
    );

    return {
      success: true,
      summary: formatSummary(report),
      data: report,
    };
  }
}

function countUniqueFiles(paths: string[]): number {
  return new Set(paths).size;
}
