"use strict";
/**
 * Detect tree-sitter ERROR / MISSING nodes — i.e. syntax errors or
 * unparseable regions in the source file.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syntaxErrorsRule = void 0;
const types_js_1 = require("./types.js");
exports.syntaxErrorsRule = {
    id: 'syntax-error',
    category: 'bug',
    defaultSeverity: 'high',
    languages: [],
    check(ctx) {
        const issues = collectErrors(ctx, ctx.tree.rootNode);
        // Deduplicate by line to avoid flooding one broken file.
        const seen = new Set();
        const unique = [];
        for (const issue of issues) {
            const line = issue.location?.line ?? 0;
            if (!seen.has(line)) {
                seen.add(line);
                unique.push(issue);
            }
        }
        return unique;
    },
};
function collectErrors(ctx, node) {
    const issues = [];
    if (node.isMissing || node.hasError) {
        const text = node.text.slice(0, 80);
        issues.push((0, types_js_1.createIssue)(exports.syntaxErrorsRule, ctx, node, node.isMissing ? 'Missing syntax node' : 'Syntax error', node.isMissing
            ? `Expected syntax is missing near "${text}".`
            : `Unexpected or invalid syntax near "${text}".`));
    }
    for (const child of node.children) {
        issues.push(...collectErrors(ctx, child));
    }
    return issues;
}
