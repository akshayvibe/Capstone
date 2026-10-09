"use strict";
/**
 * Shared helper to render an AgentReport as bounded text for LLM prompts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatAgentReport = formatAgentReport;
const MAX_REPORT_CHARS = 4000;
function formatAgentReport(report) {
    const lines = [];
    lines.push(`Agent: ${report.agent}`);
    lines.push(`Summary: ${formatSummary(report)}`);
    // Environment-specific helpful counts.
    if (report.agent === 'EnvironmentAgent') {
        const containers = report.issues.filter((i) => i.ruleId === 'docker-container').length;
        const ports = report.issues.filter((i) => i.ruleId === 'listening-port').length;
        const processes = report.issues.filter((i) => i.ruleId === 'process-cpu' || i.ruleId === 'process-mem').length;
        lines.push(`Docker containers: ${containers}, listening ports: ${ports}, process samples: ${processes}.`);
    }
    // Code/security-specific counts by rule.
    if (report.agent === 'CodeAgent' || report.agent === 'SecurityAgent') {
        const byRule = new Map();
        for (const issue of report.issues) {
            byRule.set(issue.ruleId, (byRule.get(issue.ruleId) ?? 0) + 1);
        }
        if (byRule.size > 0) {
            lines.push('Findings by rule:');
            for (const [ruleId, count] of byRule.entries()) {
                lines.push(`- ${ruleId}: ${count}`);
            }
        }
    }
    const topIssues = report.issues.slice(0, 12);
    if (topIssues.length > 0) {
        lines.push('Top findings:');
        for (const issue of topIssues) {
            const loc = issue.location?.line ? ` at ${issue.location.filePath}:${issue.location.line}` : '';
            lines.push(`- [${issue.severity}] ${issue.ruleId}: ${issue.title}${loc}`);
            if (issue.remediation)
                lines.push(`  Remediation: ${issue.remediation}`);
        }
    }
    if (report.toolsUnavailable.length > 0) {
        lines.push(`Unavailable tools: ${report.toolsUnavailable.join('; ')}`);
    }
    return lines.join('\n').slice(0, MAX_REPORT_CHARS);
}
function formatSummary(report) {
    const parts = [];
    for (const severity of ['critical', 'high', 'medium', 'low', 'info']) {
        const count = report.counts[severity];
        if (count > 0)
            parts.push(`${count} ${severity}`);
    }
    return parts.length > 0 ? parts.join(', ') : 'no issues';
}
