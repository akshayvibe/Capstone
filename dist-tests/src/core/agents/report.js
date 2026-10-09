"use strict";
/**
 * Shared report-building utilities for all specialized sub-agents.
 *
 * Single-responsibility: normalize issues, counts, summaries, and
 * raw-evidence capping so each agent stays focused on detection logic.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyReport = emptyReport;
exports.addIssue = addIssue;
exports.addToolUnavailable = addToolUnavailable;
exports.formatSummary = formatSummary;
exports.capEvidence = capEvidence;
exports.attachRawEvidence = attachRawEvidence;
exports.severityRank = severityRank;
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const RAW_EVIDENCE_MAX_CHARS = 64 * 1024;
function emptyReport(agent, intent) {
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
function addIssue(report, issue) {
    report.issues.push(issue);
    report.counts[issue.severity] += 1;
}
function addToolUnavailable(report, tool, reason) {
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
function formatSummary(report) {
    const parts = [];
    for (const severity of SEVERITY_ORDER) {
        const count = report.counts[severity];
        if (count > 0) {
            parts.push(`${count} ${severity}`);
        }
    }
    const issuesText = parts.length > 0 ? parts.join(', ') : 'no issues';
    return `${report.issues.length} ${report.issues.length === 1 ? 'issue' : 'issues'} — ${issuesText}${report.filesScanned > 0 ? ` across ${report.filesScanned} file${report.filesScanned === 1 ? '' : 's'}` : ''}`;
}
function capEvidence(raw, maxChars = RAW_EVIDENCE_MAX_CHARS) {
    if (raw.length <= maxChars)
        return raw;
    return `${raw.slice(0, maxChars - 1)}…`;
}
function attachRawEvidence(report, raw, verbose) {
    if (!verbose)
        return;
    const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    report.rawEvidence = capEvidence(serialized);
}
function severityRank(severity) {
    return SEVERITY_ORDER.indexOf(severity);
}
