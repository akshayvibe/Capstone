/**
 * npm audit wrapper for dependency-risk scanning.
 *
 * Parses `npm audit --json` and maps vulnerabilities into normalized
 * issues. Requires a lockfile; absent lockfiles produce a single info
 * issue and no tool error.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentIssue, Severity } from '../../../../types/index.js';
import { execCommand, isCommandAvailable } from '../../../../utils/exec.js';
import { ToolUnavailableError, ToolExecutionError, ToolOutputParseError } from '../../../../utils/errors.js';
import { npmAuditOutputSchema, type NpmAuditOutput, type NpmAuditVulnerability } from '../schemas.js';

const NPM_AUDIT_TIMEOUT_MS = 60_000;

export interface NpmAuditRunResult {
  readonly available: boolean;
  readonly version?: string;
  readonly output?: NpmAuditOutput;
  readonly error?: Error;
}

export async function runNpmAudit(rootPath: string): Promise<NpmAuditRunResult> {
  const available = await isCommandAvailable('npm');
  if (!available) {
    return { available: false, error: new ToolUnavailableError('npm', 'npm is not installed or not on PATH') };
  }

  const lockfile = await findLockfile(rootPath);
  if (lockfile === undefined) {
    return {
      available: true,
      error: new ToolExecutionError('npm audit', `No lockfile found in ${rootPath}`),
    };
  }

  const versionResult = await execCommand('npm', { args: ['--version'], timeoutMs: 10_000, cwd: rootPath });
  const version = versionResult.ok ? versionResult.stdout.trim() : 'unknown';

  const result = await execCommand('npm', {
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
      error: new ToolExecutionError('npm audit', result.message, { exitCode: result.exitCode }),
    };
  }

  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    const output = npmAuditOutputSchema.parse(parsed);
    return { available: true, version, output };
  } catch (err: unknown) {
    return {
      available: true,
      version,
      error: new ToolOutputParseError(
        'npm audit',
        err instanceof Error ? err.message : 'invalid npm audit JSON',
      ),
    };
  }
}

export function mapNpmAuditToIssues(output: NpmAuditOutput): AgentIssue[] {
  const issues: AgentIssue[] = [];
  const vulnerabilities = output.vulnerabilities as Record<string, NpmAuditVulnerability>;
  for (const [packageName, vuln] of Object.entries(vulnerabilities)) {
    const severity = mapSeverity(vuln.severity);
    const via = vuln.via
      ?.map((v) => (typeof v === 'string' ? v : v.title ?? v.url ?? 'unknown'))
      .filter((v): v is string => v.length > 0)
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

function mapSeverity(raw: string): Severity {
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

async function findLockfile(rootPath: string): Promise<string | undefined> {
  for (const name of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
    try {
      await fs.access(path.join(rootPath, name));
      return name;
    } catch {
      // Continue checking other lockfiles.
    }
  }
  return undefined;
}
