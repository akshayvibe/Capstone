"use strict";
/**
 * Security scanning agent.
 *
 * Orchestrates semgrep (SAST), gitleaks (secret detection), and npm audit
 * (dependency risk). Each tool runs independently; missing tools are reported
 * as info issues rather than agent failures.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityAgent = void 0;
const BaseAgent_js_1 = require("../base/BaseAgent.js");
const report_js_1 = require("../report.js");
const semgrep_js_1 = require("./tools/semgrep.js");
const gitleaks_js_1 = require("./tools/gitleaks.js");
const npmAudit_js_1 = require("./tools/npmAudit.js");
class SecurityAgent extends BaseAgent_js_1.BaseAgent {
    name = 'SecurityAgent';
    intent = 'secure';
    async run(payload) {
        const report = (0, report_js_1.emptyReport)(this.name, this.intent);
        const rootPath = process.cwd();
        const semgrepResult = await (0, semgrep_js_1.runSemgrep)(rootPath, process.env['HELIX_SEMGREP_CONFIG']);
        if (semgrepResult.available && semgrepResult.version) {
            report.toolsUsed.push(`semgrep ${semgrepResult.version}`);
        }
        if (semgrepResult.error) {
            (0, report_js_1.addToolUnavailable)(report, 'semgrep', semgrepResult.error.message);
        }
        if (semgrepResult.output) {
            for (const issue of (0, semgrep_js_1.mapSemgrepToIssues)(semgrepResult.output)) {
                (0, report_js_1.addIssue)(report, issue);
            }
            report.filesScanned += countUniqueFiles(semgrepResult.output.results.map((r) => r.path));
        }
        const gitleaksResult = await (0, gitleaks_js_1.runGitleaks)(rootPath);
        if (gitleaksResult.available && gitleaksResult.version) {
            report.toolsUsed.push(`gitleaks ${gitleaksResult.version}`);
        }
        if (gitleaksResult.error) {
            (0, report_js_1.addToolUnavailable)(report, 'gitleaks', gitleaksResult.error.message);
        }
        if (gitleaksResult.findings) {
            for (const issue of (0, gitleaks_js_1.mapGitleaksToIssues)(gitleaksResult.findings)) {
                (0, report_js_1.addIssue)(report, issue);
            }
        }
        const npmAuditResult = await (0, npmAudit_js_1.runNpmAudit)(rootPath);
        if (npmAuditResult.available && npmAuditResult.version) {
            report.toolsUsed.push(`npm ${npmAuditResult.version}`);
        }
        if (npmAuditResult.error) {
            // npm audit missing a lockfile is informative, not a hard failure.
            if (npmAuditResult.error.message.includes('No lockfile')) {
                (0, report_js_1.addIssue)(report, {
                    id: `${this.name}:npm-audit:no-lockfile`,
                    ruleId: 'npm-audit-no-lockfile',
                    title: 'No lockfile for npm audit',
                    message: npmAuditResult.error.message,
                    severity: 'info',
                    category: 'dependency',
                    evidence: npmAuditResult.error.message,
                });
            }
            else {
                (0, report_js_1.addToolUnavailable)(report, 'npm audit', npmAuditResult.error.message);
            }
        }
        if (npmAuditResult.output) {
            for (const issue of (0, npmAudit_js_1.mapNpmAuditToIssues)(npmAuditResult.output)) {
                (0, report_js_1.addIssue)(report, issue);
            }
        }
        (0, report_js_1.attachRawEvidence)(report, {
            semgrepErrors: semgrepResult.output?.errors,
            toolsUnavailable: report.toolsUnavailable,
        }, payload.options.verbose);
        return {
            success: true,
            summary: (0, report_js_1.formatSummary)(report),
            data: report,
        };
    }
}
exports.SecurityAgent = SecurityAgent;
function countUniqueFiles(paths) {
    return new Set(paths).size;
}
