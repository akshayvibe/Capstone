"use strict";
/**
 * Zod schemas for external security-tool JSON outputs.
 *
 * Runtime validation keeps the agents resilient against CLI version
 * drift or truncated output under strict TypeScript settings.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.npmAuditOutputSchema = exports.npmAuditVulnerabilitySchema = exports.gitleaksReportSchema = exports.gitleaksFindingSchema = exports.semgrepOutputSchema = exports.semgrepResultSchema = void 0;
const zod_1 = require("zod");
// -----------------------------------------------------------------------------
// Semgrep
// -----------------------------------------------------------------------------
exports.semgrepResultSchema = zod_1.z.object({
    check_id: zod_1.z.string(),
    path: zod_1.z.string(),
    start: zod_1.z.object({ line: zod_1.z.number().int(), col: zod_1.z.number().int().optional() }),
    end: zod_1.z.object({ line: zod_1.z.number().int(), col: zod_1.z.number().int().optional() }),
    extra: zod_1.z.object({
        message: zod_1.z.string().optional(),
        severity: zod_1.z.string().optional(),
        lines: zod_1.z.string().optional(),
        metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    }),
});
exports.semgrepOutputSchema = zod_1.z.object({
    results: zod_1.z.array(exports.semgrepResultSchema).default([]),
    errors: zod_1.z.array(zod_1.z.record(zod_1.z.string(), zod_1.z.unknown())).default([]),
    version: zod_1.z.string().optional(),
});
// -----------------------------------------------------------------------------
// Gitleaks
// -----------------------------------------------------------------------------
exports.gitleaksFindingSchema = zod_1.z.object({
    RuleID: zod_1.z.string(),
    File: zod_1.z.string().optional(),
    StartLine: zod_1.z.number().int().optional(),
    EndLine: zod_1.z.number().int().optional(),
    StartColumn: zod_1.z.number().int().optional(),
    EndColumn: zod_1.z.number().int().optional(),
    Match: zod_1.z.string().optional(),
    Secret: zod_1.z.string().optional(),
    Entropy: zod_1.z.number().optional(),
    Commit: zod_1.z.string().optional(),
});
exports.gitleaksReportSchema = zod_1.z.array(exports.gitleaksFindingSchema).default([]);
// -----------------------------------------------------------------------------
// npm audit
// -----------------------------------------------------------------------------
exports.npmAuditVulnerabilitySchema = zod_1.z.object({
    name: zod_1.z.string(),
    severity: zod_1.z.string(),
    via: zod_1.z.array(zod_1.z.union([zod_1.z.string(), zod_1.z.object({ title: zod_1.z.string().optional(), url: zod_1.z.string().optional() })])).optional(),
    effects: zod_1.z.array(zod_1.z.string()).optional(),
    range: zod_1.z.string().optional(),
    nodes: zod_1.z.array(zod_1.z.string()).optional(),
    fixAvailable: zod_1.z.union([zod_1.z.boolean(), zod_1.z.object({ name: zod_1.z.string(), version: zod_1.z.string() })]).optional(),
    isDirect: zod_1.z.boolean().optional(),
});
exports.npmAuditOutputSchema = zod_1.z.object({
    vulnerabilities: zod_1.z.record(zod_1.z.string(), exports.npmAuditVulnerabilitySchema).default({}),
    metadata: zod_1.z
        .object({
        vulnerabilities: zod_1.z.object({
            info: zod_1.z.number().int().optional(),
            low: zod_1.z.number().int().optional(),
            moderate: zod_1.z.number().int().optional(),
            high: zod_1.z.number().int().optional(),
            critical: zod_1.z.number().int().optional(),
        }).optional(),
    })
        .optional(),
});
