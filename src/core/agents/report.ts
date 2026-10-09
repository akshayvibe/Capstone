/**
 * Shared report-building utilities for all specialized sub-agents.
 *
 * Single-responsibility: normalize issues, counts, summaries, and
 * raw-evidence capping so each agent stays focused on detection logic.
 */

import type { AgentIntent, AgentIssue, AgentReport, Severity } from '../../types/index.js';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const RAW_EVIDENCE_MAX_CHARS = 64 * 1024;

export function emptyReport(agent: string, intent: AgentIntent): AgentReport {
  return {
    agent,
    intent,
    generatedAt: new Date().toISOString(),
    issues: [],
    counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    filesScanned: 0,
    toolsUsed: [],
    toolsUnavailable: [],
  };
}

export function addIssue(report: AgentReport, issue: AgentIssue): void {
  report.issues.push(issue);
  report.counts[issue.severity] += 1;
}

export function addToolUnavailable(report: AgentReport, tool: string, reason: string): void {
  report.toolsUnavailable.push(`${tool}: ${reason}`);
  addIssue(report, {
    id: `${report.agent}:tool-unavailable:${tool}`,
    ruleId: 'tool-unavailable',
    title: `${tool} is unavailable`,
    message: reason,
    severity: 'info',
    category: 'environment',
    evidence: `${tool} could not be executed`,
  });
}

export function formatSummary(report: AgentReport): string {
  const parts: string[] = [];
  for (const severity of SEVERITY_ORDER) {
    const count = report.counts[severity];
    if (count > 0) {
      parts.push(`${count} ${severity}`);
    }
  }
  const issuesText = parts.length > 0 ? parts.join(', ') : 'no issues';
  return `${report.issues.length} ${report.issues.length === 1 ? 'issue' : 'issues'} — ${issuesText}${report.filesScanned > 0 ? ` across ${report.filesScanned} file${report.filesScanned === 1 ? '' : 's'}` : ''}`;
}

export function capEvidence(raw: string, maxChars: number = RAW_EVIDENCE_MAX_CHARS): string {
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars - 1)}…`;
}

export function attachRawEvidence(report: AgentReport, raw: unknown, verbose: boolean): void {
  if (!verbose) return;
  const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  report.rawEvidence = capEvidence(serialized);
}

export function severityRank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}
