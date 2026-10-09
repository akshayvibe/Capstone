"use strict";
/**
 * Semgrep wrapper: availability check, execution, JSON parsing, and
 * normalized issue mapping for the SecurityAgent.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSemgrep = runSemgrep;
exports.mapSemgrepToIssues = mapSemgrepToIssues;
const exec_js_1 = require("../../../../utils/exec.js");
const errors_js_1 = require("../../../../utils/errors.js");
const schemas_js_1 = require("../schemas.js");
const SEMGREP_TIMEOUT_MS = 120_000;
async function runSemgrep(rootPath, config) {
    const available = await (0, exec_js_1.isCommandAvailable)('semgrep');
    if (!available) {
        return { available: false, error: new errors_js_1.ToolUnavailableError('semgrep', 'semgrep is not installed or not on PATH') };
    }
    const versionResult = await (0, exec_js_1.execCommand)('semgrep', { args: ['--version'], timeoutMs: 10_000 });
    const version = versionResult.ok ? versionResult.stdout.trim() : 'unknown';
    const result = await (0, exec_js_1.execCommand)('semgrep', {
        args: [
            'scan',
            '--config',
            config ?? 'auto',
            '--json',
            '--quiet',
            '--metrics',
            'off',
            rootPath,
        ],
        timeoutMs: SEMGREP_TIMEOUT_MS,
        // Semgrep exits 1 when findings exist; that is success for us.
        permitNonZeroExit: [1],
    });
    if (!result.ok) {
        return {
            available: true,
            version,
            error: new errors_js_1.ToolExecutionError('semgrep', result.message, {
                exitCode: result.exitCode,
                stderr: 'stderr' in result ? result.stderr : '',
            }),
        };
    }
    try {
        const parsed = JSON.parse(result.stdout);
        const output = schemas_js_1.semgrepOutputSchema.parse(parsed);
        return { available: true, version, output };
    }
    catch (err) {
        return {
            available: true,
            version,
            error: new errors_js_1.ToolOutputParseError('semgrep', err instanceof Error ? err.message : 'invalid JSON output', { cause: err instanceof Error ? err.message : String(err) }),
        };
    }
}
function mapSemgrepToIssues(output) {
    return output.results.map((result) => {
        const severity = mapSeverity(result.extra.severity ?? 'WARNING');
        const checkId = result.check_id;
        const filePath = result.path;
        const line = result.start.line;
        const metadata = result.extra.metadata ?? {};
        const cwe = metadata['cwe'];
        const owasp = metadata['owasp'];
        return {
            id: `semgrep:${checkId}:${filePath}:${line}`,
            ruleId: checkId,
            title: checkId.split('.').pop() ?? checkId,
            message: result.extra.message ?? 'Security issue detected by semgrep',
            severity,
            category: 'vulnerability',
            location: {
                filePath,
                line,
                column: result.start.col,
                endLine: result.end.line,
                endColumn: result.end.col,
            },
            evidence: (result.extra.lines ?? '').slice(0, 500),
            remediation: owasp !== undefined ? `OWASP: ${owasp}` : undefined,
            metadata: {
                ...(typeof cwe === 'string' || typeof cwe === 'number' ? { cwe } : {}),
                ...(typeof owasp === 'string' ? { owasp } : {}),
            },
        };
    });
}
function mapSeverity(raw) {
    switch (raw.toUpperCase()) {
        case 'ERROR':
            return 'high';
        case 'WARNING':
            return 'medium';
        case 'INFO':
            return 'low';
        default:
            return 'medium';
    }
}
