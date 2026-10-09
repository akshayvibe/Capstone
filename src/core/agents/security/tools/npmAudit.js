"use strict";
/**
 * npm audit wrapper for dependency-risk scanning.
 *
 * Parses `npm audit --json` and maps vulnerabilities into normalized
 * issues. Requires a lockfile; absent lockfiles produce a single info
 * issue and no tool error.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runNpmAudit = runNpmAudit;
exports.mapNpmAuditToIssues = mapNpmAuditToIssues;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const exec_js_1 = require("../../../../utils/exec.js");
const errors_js_1 = require("../../../../utils/errors.js");
const schemas_js_1 = require("../schemas.js");
const NPM_AUDIT_TIMEOUT_MS = 60_000;
async function runNpmAudit(rootPath) {
    const available = await (0, exec_js_1.isCommandAvailable)('npm');
    if (!available) {
        return { available: false, error: new errors_js_1.ToolUnavailableError('npm', 'npm is not installed or not on PATH') };
    }
    const lockfile = await findLockfile(rootPath);
    if (lockfile === undefined) {
        return {
            available: true,
            error: new errors_js_1.ToolExecutionError('npm audit', `No lockfile found in ${rootPath}`),
        };
    }
    const versionResult = await (0, exec_js_1.execCommand)('npm', { args: ['--version'], timeoutMs: 10_000, cwd: rootPath });
    const version = versionResult.ok ? versionResult.stdout.trim() : 'unknown';
    const result = await (0, exec_js_1.execCommand)('npm', {
        args: ['audit', '--json'],
        timeoutMs: NPM_AUDIT_TIMEOUT_MS,
        cwd: rootPath,
        // npm audit exits 1 when vulnerabilities are found.
        permitNonZeroExit: [1],
    });
    if (!result.ok) {
        return {
            available: true,
            version,
            error: new errors_js_1.ToolExecutionError('npm audit', result.message, { exitCode: result.exitCode }),
        };
    }
    try {
        const parsed = JSON.parse(result.stdout);
        const output = schemas_js_1.npmAuditOutputSchema.parse(parsed);
        return { available: true, version, output };
    }
    catch (err) {
        return {
            available: true,
            version,
            error: new errors_js_1.ToolOutputParseError('npm audit', err instanceof Error ? err.message : 'invalid npm audit JSON'),
        };
    }
}
function mapNpmAuditToIssues(output) {
    const issues = [];
    const vulnerabilities = output.vulnerabilities;
    for (const [packageName, vuln] of Object.entries(vulnerabilities)) {
        const severity = mapSeverity(vuln.severity);
        const via = vuln.via
            ?.map((v) => (typeof v === 'string' ? v : v.title ?? v.url ?? 'unknown'))
            .filter((v) => v.length > 0)
            .join(', ');
        const fixText = vuln.fixAvailable === true
            ? 'Update available.'
            : vuln.fixAvailable === false
                ? 'No update available.'
                : vuln.fixAvailable !== undefined
                    ? `Update to ${String(vuln.fixAvailable.name)}@${String(vuln.fixAvailable.version)}.`
                    : undefined;
        issues.push({
            id: `npm-audit:${packageName}:${vuln.severity}`,
            ruleId: 'npm-audit-vulnerability',
            title: `Vulnerable dependency: ${packageName}`,
            message: `${packageName}${vuln.range ? `@${vuln.range}` : ''} has a ${vuln.severity} severity vulnerability${via ? ` via ${via}` : ''}.${fixText ? ` ${fixText}` : ''}`,
            severity,
            category: 'dependency',
            location: { filePath: 'package.json' },
            evidence: via ?? vuln.range ?? `severity=${vuln.severity}`,
            remediation: fixText,
            metadata: {
                package: packageName,
                range: vuln.range ?? 'unknown',
                isDirect: vuln.isDirect ?? false,
                via: via ?? 'unknown',
            },
        });
    }
    return issues;
}
function mapSeverity(raw) {
    switch (raw.toLowerCase()) {
        case 'critical':
            return 'critical';
        case 'high':
            return 'high';
        case 'moderate':
            return 'medium';
        case 'low':
            return 'low';
        case 'info':
            return 'info';
        default:
            return 'medium';
    }
}
async function findLockfile(rootPath) {
    for (const name of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
        try {
            await promises_1.default.access(node_path_1.default.join(rootPath, name));
            return name;
        }
        catch {
            // Continue checking other lockfiles.
        }
    }
    return undefined;
}
