/**
 * Semgrep wrapper: availability check, execution, JSON parsing, and
 * normalized issue mapping for the SecurityAgent.
 */

import type { AgentIssue, Severity } from '../../../../types/index.js';
import { execCommand, isCommandAvailable } from '../../../../utils/exec.js';
import { ToolUnavailableError, ToolExecutionError, ToolOutputParseError } from '../../../../utils/errors.js';
import { semgrepOutputSchema, type SemgrepOutput } from '../schemas.js';

const SEMGREP_TIMEOUT_MS = 120_000;

export interface SemgrepRunResult {
  readonly available: boolean;
  readonly version?: string;
  readonly output?: SemgrepOutput;
  readonly error?: Error;
}

export async function runSemgrep(rootPath: string, config?: string): Promise<SemgrepRunResult> {
  const available = await isCommandAvailable('semgrep');
  if (!available) {
    return { available: false, error: new ToolUnavailableError('semgrep', 'semgrep is not installed or not on PATH') };
  }

  const versionResult = await execCommand('semgrep', { args: ['--version'], timeoutMs: 10_000 });
  const version = versionResult.ok ? versionResult.stdout.trim() : 'unknown';

  const result = await execCommand('semgrep', {
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
      error: new ToolExecutionError('semgrep', result.message, {
        exitCode: result.exitCode,
        stderr: 'stderr' in result ? result.stderr : '',
      }),
    };
  }

  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    const output = semgrepOutputSchema.parse(parsed);
    return { available: true, version, output };
  } catch (err: unknown) {
    return {
      available: true,
      version,
      error: new ToolOutputParseError(
        'semgrep',
        err instanceof Error ? err.message : 'invalid JSON output',
        { cause: err instanceof Error ? err.message : String(err) },
      ),
    };
  }
}

export function mapSemgrepToIssues(output: SemgrepOutput): AgentIssue[] {
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

function mapSeverity(raw: string): Severity {
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
