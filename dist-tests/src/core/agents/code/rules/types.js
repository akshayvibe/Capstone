"use strict";
/**
 * Code analysis rule types.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIssue = createIssue;
function createIssue(rule, ctx, node, title, message, overrides) {
    const start = node.startPosition;
    const end = node.endPosition;
    return {
        id: `${rule.id}:${ctx.filePath}:${start.row + 1}:${start.column}`,
        ruleId: rule.id,
        title,
        message,
        severity: overrides?.severity ?? rule.defaultSeverity,
        category: rule.category,
        location: {
            filePath: ctx.filePath,
            line: start.row + 1,
            column: start.column + 1,
            endLine: end.row + 1,
            endColumn: end.column + 1,
        },
        evidence: ctx.source.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 300)),
        remediation: overrides?.remediation,
    };
}
