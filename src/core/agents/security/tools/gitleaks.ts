/**
 * Gitleaks wrapper: detect exposed secrets, redact evidence, and map
 * findings into normalized issues.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentIssue } from '../../../../types/index.js';
import { execCommand, isCommandAvailable } from '../../../../utils/exec.js';
import { ToolUnavailableError, ToolExecutionError, ToolOutputParseError } from '../../../../utils/errors.js';
import { gitleaksReportSchema, type GitleaksReport } from '../schemas.js';

const GITLEAKS_TIMEOUT_MS = 120_000;

export interface GitleaksRunResult {
  readonly available: boolean;
  readonly version?: string;
  readonly findings?: GitleaksReport;
  readonly error?: Error;
}

export async function runGitleaks(rootPath: string): Promise<GitleaksRunResult> {
  const available = await isCommandAvailable('gitleaks');
  if (!available) {
    return { available: false, error: new ToolUnavailableError('gitleaks', 'gitleaks is not installed or not on PATH') };
  }

  const versionResult = await execCommand('gitleaks', { args: ['--version'], timeoutMs: 10_000 });
  const version = versionResult.ok ? versionResult.stdout.trim() : 'unknown';

  const reportPath = path.join(os.tmpdir(), `helix-gitleaks-${randomUUID()}.json`);

  try {
    const result = await execCommand('gitleaks', {
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
        error: new ToolExecutionError('gitleaks', result.message),
      };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(reportPath, 'utf8')) as unknown;
    } catch (err: unknown) {
      return {
        available: true,
        version,
        error: new ToolOutputParseError(
          'gitleaks',
          err instanceof Error ? err.message : 'could not read gitleaks report',
        ),
      };
    } finally {
      await fs.unlink(reportPath).catch(() => {
        // Best-effort cleanup; ignore failure.
      });
    }

    try {
      const findings = gitleaksReportSchema.parse(raw);
      return { available: true, version, findings };
    } catch (err: unknown) {
      return {
        available: true,
        version,
        error: new ToolOutputParseError(
          'gitleaks',
          err instanceof Error ? err.message : 'invalid gitleaks report schema',
        ),
      };
    }
  } catch (err: unknown) {
    return {
      available: true,
      version,
      error: err instanceof Error ? err : new ToolExecutionError('gitleaks', String(err)),
    };
  }
}

export function mapGitleaksToIssues(findings: GitleaksReport): AgentIssue[] {
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

function redactSecret(evidence: string, secret: string): string {
  if (secret.length === 0) return evidence;
  // Replace exact secret occurrences with `[REDACTED]`.
  const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return evidence.replace(new RegExp(escaped, 'g'), '[REDACTED]');
}
