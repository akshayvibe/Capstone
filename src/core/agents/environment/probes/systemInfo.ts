/**
 * Local OS metrics probe.
 *
 * No subprocess required; uses Node's `os` module and reports
 * resource pressure as low-severity environment findings.
 */

import os from 'node:os';
import type { AgentReport } from '../../../../types/index.js';
import { addIssue } from '../../report.js';

export function probeSystemInfo(report: AgentReport): void {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedRatio = totalMem > 0 ? (totalMem - freeMem) / totalMem : 0;
  const loadAvg = os.loadavg();
  const cpuCount = os.cpus().length;
  const uptimeHours = os.uptime() / 3600;

  addIssue(report, {
    id: `${report.agent}:system:info`,
    ruleId: 'system-info',
    title: 'System resource snapshot',
    message: `Memory ${(usedRatio * 100).toFixed(1)}% used (${formatBytes(totalMem - freeMem)} / ${formatBytes(totalMem)}), load avg [${loadAvg.map((n) => n.toFixed(2)).join(', ')}], ${cpuCount} CPUs, uptime ${uptimeHours.toFixed(1)}h`,
    severity: 'info',
    category: 'environment',
    evidence: `freemem=${formatBytes(freeMem)} totalmem=${formatBytes(totalMem)} loadavg=[${loadAvg.join(', ')}]`,
    metadata: {
      freeMemBytes: freeMem,
      totalMemBytes: totalMem,
      loadAvg1m: loadAvg[0] ?? 0,
      loadAvg5m: loadAvg[1] ?? 0,
      loadAvg15m: loadAvg[2] ?? 0,
      cpuCount,
      uptimeSeconds: os.uptime(),
    },
  });

  if (usedRatio > 0.9) {
    addIssue(report, {
      id: `${report.agent}:system:memory-pressure`,
      ruleId: 'memory-pressure',
      title: 'Memory usage is critically high',
      message: `More than 90% of system memory is in use (${(usedRatio * 100).toFixed(1)}%).`,
      severity: 'high',
      category: 'environment',
      evidence: `usedRatio=${usedRatio.toFixed(3)}`,
    });
  } else if (usedRatio > 0.75) {
    addIssue(report, {
      id: `${report.agent}:system:memory-elevated`,
      ruleId: 'memory-elevated',
      title: 'Memory usage is elevated',
      message: `More than 75% of system memory is in use (${(usedRatio * 100).toFixed(1)}%).`,
      severity: 'low',
      category: 'environment',
      evidence: `usedRatio=${usedRatio.toFixed(3)}`,
    });
  }

  if (cpuCount > 0 && loadAvg[0] !== undefined && loadAvg[0] > cpuCount) {
    addIssue(report, {
      id: `${report.agent}:system:load-high`,
      ruleId: 'load-high',
      title: 'CPU load is high',
      message: `1-minute load average (${loadAvg[0].toFixed(2)}) exceeds CPU count (${cpuCount}).`,
      severity: 'medium',
      category: 'environment',
      evidence: `loadAvg1m=${loadAvg[0]} cpuCount=${cpuCount}`,
    });
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
