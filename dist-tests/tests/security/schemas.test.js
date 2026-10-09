"use strict";
/**
 * Tests for security tool JSON schema parsing.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = __importDefault(require("node:fs/promises"));
const schemas_js_1 = require("../../src/core/agents/security/schemas.js");
(0, node_test_1.describe)('security schemas', () => {
    (0, node_test_1.it)('parses a valid semgrep JSON fixture', async () => {
        const raw = JSON.parse(await promises_1.default.readFile('tests/fixtures/security/semgrep-results.json', 'utf8'));
        const output = schemas_js_1.semgrepOutputSchema.parse(raw);
        strict_1.default.equal(output.results.length, 2);
        strict_1.default.equal(output.results[0]?.check_id, 'javascript.express.security.audit.express-check-csurf-middleware-usage');
    });
    (0, node_test_1.it)('parses a valid gitleaks JSON fixture', async () => {
        const raw = JSON.parse(await promises_1.default.readFile('tests/fixtures/security/gitleaks-report.json', 'utf8'));
        const findings = schemas_js_1.gitleaksReportSchema.parse(raw);
        strict_1.default.equal(findings.length, 1);
        strict_1.default.equal(findings[0]?.RuleID, 'aws-access-key');
    });
    (0, node_test_1.it)('parses a valid npm audit JSON fixture', async () => {
        const raw = JSON.parse(await promises_1.default.readFile('tests/fixtures/security/npm-audit.json', 'utf8'));
        const output = schemas_js_1.npmAuditOutputSchema.parse(raw);
        strict_1.default.ok(output.vulnerabilities['lodash']);
        strict_1.default.ok(output.vulnerabilities['minimist']);
    });
});
