"use strict";
/**
 * Gitleaks wrapper: detect exposed secrets, redact evidence, and map
 * findings into normalized issues.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runGitleaks = runGitleaks;
exports.mapGitleaksToIssues = mapGitleaksToIssues;
const node_crypto_1 = require("node:crypto");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const exec_js_1 = require("../../../../utils/exec.js");
const errors_js_1 = require("../../../../utils/errors.js");
const schemas_js_1 = require("../schemas.js");
const GITLEAKS_TIMEOUT_MS = 120_000;
async function runGitleaks(rootPath) {
    const available = await (0, exec_js_1.isCommandAvailable)('gitleaks');
    if (!available) {
        return { available: false, error: new errors_js_1.ToolUnavailableError('gitleaks', 'gitleaks is not installed or not on PATH') };
    }
    const versionResult = await (0, exec_js_1.execCommand)('gitleaks', { args: ['--version'], timeoutMs: 10_000 });
    const version = versionResult.ok ? versionResult.stdout.trim() : 'unknown';
    const reportPath = node_path_1.default.join(node_os_1.default.tmpdir(), `helix-gitleaks-${(0, node_crypto_1.randomUUID)()}.json`);
    try {
        const result = await (0, exec_js_1.execCommand)('gitleaks', {
            args: [
                'detect',
                '--source',
                rootPath,
                '--report-format',
                'json',
                '--report-path',
                reportPath,
                '--exit-code',
                '0',
                '--redact',
            ],
            timeoutMs: GITLEAKS_TIMEOUT_MS,
        });
        if (!result.ok) {
            return {
                available: true,
                version,
                error: new errors_js_1.ToolExecutionError('gitleaks', result.message),
            };
        }
        let raw;
        try {
            raw = JSON.parse(await promises_1.default.readFile(reportPath, 'utf8'));
        }
        catch (err) {
            return {
                available: true,
                version,
                error: new errors_js_1.ToolOutputParseError('gitleaks', err instanceof Error ? err.message : 'could not read gitleaks report'),
            };
        }
        finally {
            await promises_1.default.unlink(reportPath).catch(() => {
                // Best-effort cleanup; ignore failure.
            });
        }
        try {
            const findings = schemas_js_1.gitleaksReportSchema.parse(raw);
            return { available: true, version, findings };
        }
        catch (err) {
            return {
                available: true,
                version,
                error: new errors_js_1.ToolOutputParseError('gitleaks', err instanceof Error ? err.message : 'invalid gitleaks report schema'),
            };
        }
    }
    catch (err) {
        return {
            available: true,
            version,
            error: err instanceof Error ? err : new errors_js_1.ToolExecutionError('gitleaks', String(err)),
        };
    }
}
function mapGitleaksToIssues(findings) {
    return findings.map((finding) => {
        const ruleId = finding.RuleID;
        const filePath = finding.File ?? 'unknown';
        const line = finding.StartLine ?? 0;
        const secret = finding.Secret ?? '';
        const evidence = (finding.Match ?? '').slice(0, 500);
        return {
            id: `gitleaks:${ruleId}:${filePath}:${line}`,
            ruleId,
            title: `Exposed secret: ${ruleId}`,
            message: `Gitleaks detected a ${ruleId} secret${filePath !== 'unknown' ? ` in ${filePath}:${line}` : ''}. The secret has been redacted from the report.`,
            severity: 'critical',
            category: 'secret',
            location: {
                filePath,
                line: line > 0 ? line : undefined,
                column: finding.StartColumn,
                endLine: finding.EndLine,
                endColumn: finding.EndColumn,
            },
            evidence: redactSecret(evidence, secret),
            remediation: 'Rotate the exposed credential and remove it from git history.',
            metadata: {
                entropy: finding.Entropy ?? 0,
                commit: finding.Commit ?? 'unknown',
            },
        };
    });
}
function redactSecret(evidence, secret) {
    if (secret.length === 0)
        return evidence;
    // Replace exact secret occurrences with `[REDACTED]`.
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return evidence.replace(new RegExp(escaped, 'g'), '[REDACTED]');
}
