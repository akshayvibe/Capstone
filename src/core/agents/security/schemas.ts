/**
 * Zod schemas for external security-tool JSON outputs.
 *
 * Runtime validation keeps the agents resilient against CLI version
 * drift or truncated output under strict TypeScript settings.
 */

import { z } from 'zod';

// -----------------------------------------------------------------------------
// Semgrep
// -----------------------------------------------------------------------------

export const semgrepResultSchema = z.object({
  check_id: z.string(),
  path: z.string(),
  start: z.object({ line: z.number().int(), col: z.number().int().optional() }),
  end: z.object({ line: z.number().int(), col: z.number().int().optional() }),
  extra: z.object({
    message: z.string().optional(),
    severity: z.string().optional(),
    lines: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const semgrepOutputSchema = z.object({
  results: z.array(semgrepResultSchema).default([]),
  errors: z.array(z.record(z.string(), z.unknown())).default([]),
  version: z.string().optional(),
});

export type SemgrepOutput = z.infer<typeof semgrepOutputSchema>;
export type SemgrepResult = z.infer<typeof semgrepResultSchema>;

// -----------------------------------------------------------------------------
// Gitleaks
// -----------------------------------------------------------------------------

export const gitleaksFindingSchema = z.object({
  RuleID: z.string(),
  File: z.string().optional(),
  StartLine: z.number().int().optional(),
  EndLine: z.number().int().optional(),
  StartColumn: z.number().int().optional(),
  EndColumn: z.number().int().optional(),
  Match: z.string().optional(),
  Secret: z.string().optional(),
  Entropy: z.number().optional(),
  Commit: z.string().optional(),
});

export const gitleaksReportSchema = z.array(gitleaksFindingSchema).default([]);

export type GitleaksReport = z.infer<typeof gitleaksReportSchema>;
export type GitleaksFinding = z.infer<typeof gitleaksFindingSchema>;

// -----------------------------------------------------------------------------
// npm audit
// -----------------------------------------------------------------------------

export const npmAuditVulnerabilitySchema = z.object({
  name: z.string(),
  severity: z.string(),
  via: z.array(z.union([z.string(), z.object({ title: z.string().optional(), url: z.string().optional() })])).optional(),
  effects: z.array(z.string()).optional(),
  range: z.string().optional(),
  nodes: z.array(z.string()).optional(),
  fixAvailable: z.union([z.boolean(), z.object({ name: z.string(), version: z.string() })]).optional(),
  isDirect: z.boolean().optional(),
});

export const npmAuditOutputSchema = z.object({
  vulnerabilities: z.record(z.string(), npmAuditVulnerabilitySchema).default({}),
  metadata: z
    .object({
      vulnerabilities: z.object({
        info: z.number().int().optional(),
        low: z.number().int().optional(),
        moderate: z.number().int().optional(),
        high: z.number().int().optional(),
        critical: z.number().int().optional(),
      }).optional(),
    })
    .optional(),
});

export type NpmAuditOutput = z.infer<typeof npmAuditOutputSchema>;
export type NpmAuditVulnerability = z.infer<typeof npmAuditVulnerabilitySchema>;
