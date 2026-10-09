/**
 * Git repository probe.
 *
 * Read-only commands: rev-parse, status --porcelain=v2 --branch, log -1.
 * Reports repository health, branch state, and dirty files.
 */

import type { AgentReport } from '../../../../types/index.js';
import { addIssue, addToolUnavailable } from '../../report.js';
import { execCommand } from '../../../../utils/exec.js';

const GIT_TIMEOUT_MS = 10_000;

export async function probeGit(report: AgentReport, rootPath: string): Promise<void> {
  const available = await execCommand('git', { args: ['--version'], timeoutMs: GIT_TIMEOUT_MS });
  if (!available.ok) {
    addToolUnavailable(report, 'git', available.message);
    return;
  }

  const revParse = await execCommand('git', {
    args: ['-C', rootPath, 'rev-parse', '--is-inside-work-tree'],
    timeoutMs: GIT_TIMEOUT_MS,
  });

  if (!revParse.ok || revParse.stdout.trim() !== 'true') {
    addIssue(report, {
      id: `${report.agent}:git:not-repo`,
      ruleId: 'git-not-repo',
      title: 'Directory is not a Git repository',
      message: `${rootPath} is not inside a Git work tree.`,
      severity: 'info',
      category: 'environment',
      evidence: revParse.ok ? revParse.stdout : revParse.message,
    });
    return;
  }

  const statusResult = await execCommand('git', {
    args: ['-C', rootPath, 'status', '--porcelain=v2', '--branch'],
    timeoutMs: GIT_TIMEOUT_MS,
  });

  const logResult = await execCommand('git', {
    args: ['-C', rootPath, 'log', '-1', '--format=%H %s'],
    timeoutMs: GIT_TIMEOUT_MS,
  });

  let branch = 'unknown';
  let ahead = 0;
  let behind = 0;
  let dirty = 0;

  if (statusResult.ok) {
    for (const line of statusResult.stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# branch.head ')) {
        branch = trimmed.slice('# branch.head '.length).trim();
      } else if (trimmed.startsWith('# branch.ab ')) {
        const parts = trimmed.split(/\s+/);
        ahead = parseInt(parts[2] ?? '0', 10) || 0;
        behind = parseInt(parts[3] ?? '0', 10) || 0;
      } else if (trimmed.length > 0 && !trimmed.startsWith('#')) {
        dirty += 1;
      }
    }
  }

  const lastCommit = logResult.ok ? logResult.stdout.trim() : 'unknown';

  addIssue(report, {
    id: `${report.agent}:git:status`,
    ruleId: 'git-status',
    title: `Git repository on branch ${branch}`,
    message: `Branch ${branch}, ${dirty} dirty file${dirty === 1 ? '' : 's'}, ${ahead} ahead, ${behind} behind.`,
    severity: dirty > 0 || ahead > 0 || behind > 0 ? 'low' : 'info',
    category: 'environment',
    evidence: `branch=${branch} dirty=${dirty} ahead=${ahead} behind=${behind} lastCommit=${lastCommit.slice(0, 40)}`,
    metadata: { branch, dirty, ahead, behind, lastCommit },
  });
}
