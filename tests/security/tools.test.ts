/**
 * Tests for security tool issue mapping.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { semgrepOutputSchema, gitleaksReportSchema, npmAuditOutputSchema } from '../../src/core/agents/security/schemas.js';
import { mapSemgrepToIssues } from '../../src/core/agents/security/tools/semgrep.js';
import { mapGitleaksToIssues } from '../../src/core/agents/security/tools/gitleaks.js';
import { mapNpmAuditToIssues } from '../../src/core/agents/security/tools/npmAudit.js';

describe('security tool issue mapping', () => {
  it('maps semgrep results to normalized issues', async () => {
    const raw = JSON.parse(await fs.readFile('tests/fixtures/security/semgrep-results.json', 'utf8')) as unknown;
    const output = semgrepOutputSchema.parse(raw);
    const issues = mapSemgrepToIssues(output);
    assert.equal(issues.length, 2);
    assert.equal(issues[0]?.severity, 'medium');
    assert.equal(issues[1]?.severity, 'high');
    assert.equal(issues[0]?.category, 'vulnerability');
  });

  it('maps gitleaks findings to normalized issues and redacts secrets', async () => {
    const raw = JSON.parse(await fs.readFile('tests/fixtures/security/gitleaks-report.json', 'utf8')) as unknown;
    const findings = gitleaksReportSchema.parse(raw);
    const issues = mapGitleaksToIssues(findings);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.severity, 'critical');
    assert.equal(issues[0]?.category, 'secret');
    assert.match(issues[0]?.evidence ?? '', /\[REDACTED\]/);
  });

  it('redacts raw secrets when gitleaks did not redact the Match field', () => {
    const issues = mapGitleaksToIssues([
      {
        RuleID: 'aws-access-key',
        File: 'config.env',
        StartLine: 1,
        Match: 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
        Secret: 'AKIAIOSFODNN7EXAMPLE',
      },
    ]);
    assert.equal(issues.length, 1);
    assert.doesNotMatch(issues[0]?.evidence ?? '', /AKIAIOSFODNN7EXAMPLE/);
    assert.match(issues[0]?.evidence ?? '', /\[REDACTED\]/);
  });

  it('maps npm audit results to normalized issues', async () => {
    const raw = JSON.parse(await fs.readFile('tests/fixtures/security/npm-audit.json', 'utf8')) as unknown;
    const output = npmAuditOutputSchema.parse(raw);
    const issues = mapNpmAuditToIssues(output);
    assert.equal(issues.length, 2);
    const severities = issues.map((i) => i.severity).sort();
    assert.deepEqual(severities, ['low', 'medium']);
    assert.ok(issues.some((i) => i.remediation?.includes('4.17.21')));
  });
});
