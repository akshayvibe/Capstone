/**
 * Tests for security tool JSON schema parsing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  semgrepOutputSchema,
  gitleaksReportSchema,
  npmAuditOutputSchema,
} from '../../src/core/agents/security/schemas.js';

describe('security schemas', () => {
  it('parses a valid semgrep JSON fixture', async () => {
    const raw = JSON.parse(await fs.readFile('tests/fixtures/security/semgrep-results.json', 'utf8')) as unknown;
    const output = semgrepOutputSchema.parse(raw);
    assert.equal(output.results.length, 2);
    assert.equal(output.results[0]?.check_id, 'javascript.express.security.audit.express-check-csurf-middleware-usage');
  });

  it('parses a valid gitleaks JSON fixture', async () => {
    const raw = JSON.parse(await fs.readFile('tests/fixtures/security/gitleaks-report.json', 'utf8')) as unknown;
    const findings = gitleaksReportSchema.parse(raw);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.RuleID, 'aws-access-key');
  });

  it('parses a valid npm audit JSON fixture', async () => {
    const raw = JSON.parse(await fs.readFile('tests/fixtures/security/npm-audit.json', 'utf8')) as unknown;
    const output = npmAuditOutputSchema.parse(raw);
    assert.ok(output.vulnerabilities['lodash']);
    assert.ok(output.vulnerabilities['minimist']);
  });
});
