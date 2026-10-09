"use strict";
/**
 * Tests for security tool issue mapping.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = __importDefault(require("node:fs/promises"));
const schemas_js_1 = require("../../src/core/agents/security/schemas.js");
const semgrep_js_1 = require("../../src/core/agents/security/tools/semgrep.js");
const gitleaks_js_1 = require("../../src/core/agents/security/tools/gitleaks.js");
const npmAudit_js_1 = require("../../src/core/agents/security/tools/npmAudit.js");
(0, node_test_1.describe)('security tool issue mapping', () => {
    (0, node_test_1.it)('maps semgrep results to normalized issues', async () => {
        const raw = JSON.parse(await promises_1.default.readFile('tests/fixtures/security/semgrep-results.json', 'utf8'));
        const output = schemas_js_1.semgrepOutputSchema.parse(raw);
        const issues = (0, semgrep_js_1.mapSemgrepToIssues)(output);
        strict_1.default.equal(issues.length, 2);
        strict_1.default.equal(issues[0]?.severity, 'medium');
        strict_1.default.equal(issues[1]?.severity, 'high');
        strict_1.default.equal(issues[0]?.category, 'vulnerability');
    });
    (0, node_test_1.it)('maps gitleaks findings to normalized issues and redacts secrets', async () => {
        const raw = JSON.parse(await promises_1.default.readFile('tests/fixtures/security/gitleaks-report.json', 'utf8'));
        const findings = schemas_js_1.gitleaksReportSchema.parse(raw);
        const issues = (0, gitleaks_js_1.mapGitleaksToIssues)(findings);
        strict_1.default.equal(issues.length, 1);
        strict_1.default.equal(issues[0]?.severity, 'critical');
        strict_1.default.equal(issues[0]?.category, 'secret');
        strict_1.default.match(issues[0]?.evidence ?? '', /\[REDACTED\]/);
    });
    (0, node_test_1.it)('redacts raw secrets when gitleaks did not redact the Match field', () => {
        const issues = (0, gitleaks_js_1.mapGitleaksToIssues)([
            {
                RuleID: 'aws-access-key',
                File: 'config.env',
                StartLine: 1,
                Match: 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
                Secret: 'AKIAIOSFODNN7EXAMPLE',
            },
        ]);
        strict_1.default.equal(issues.length, 1);
        strict_1.default.doesNotMatch(issues[0]?.evidence ?? '', /AKIAIOSFODNN7EXAMPLE/);
        strict_1.default.match(issues[0]?.evidence ?? '', /\[REDACTED\]/);
    });
    (0, node_test_1.it)('maps npm audit results to normalized issues', async () => {
        const raw = JSON.parse(await promises_1.default.readFile('tests/fixtures/security/npm-audit.json', 'utf8'));
        const output = schemas_js_1.npmAuditOutputSchema.parse(raw);
        const issues = (0, npmAudit_js_1.mapNpmAuditToIssues)(output);
        strict_1.default.equal(issues.length, 2);
        const severities = issues.map((i) => i.severity).sort();
        strict_1.default.deepEqual(severities, ['low', 'medium']);
        strict_1.default.ok(issues.some((i) => i.remediation?.includes('4.17.21')));
    });
});
