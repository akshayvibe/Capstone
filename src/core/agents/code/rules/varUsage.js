"use strict";
/**
 * Flag `var` declarations in favour of `let` or `const`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.varUsageRule = void 0;
const types_js_1 = require("./types.js");
exports.varUsageRule = {
    id: 'var-usage',
    category: 'code-quality',
    defaultSeverity: 'low',
    languages: ['typescript', 'tsx', 'javascript', 'jsx'],
    check(ctx) {
        const cursor = ctx.tree.walk();
        const issues = traverse(ctx, cursor);
        cursor.delete();
        return issues;
    },
};
function traverse(ctx, cursor) {
    const issues = [];
    if (cursor.nodeType === 'var') {
        issues.push((0, types_js_1.createIssue)(exports.varUsageRule, ctx, cursor.currentNode, 'Use of var declaration', 'Prefer `const` or `let` over `var` to avoid function-scoping surprises.'));
    }
    if (cursor.gotoFirstChild()) {
        issues.push(...traverse(ctx, cursor));
        while (cursor.gotoNextSibling()) {
            issues.push(...traverse(ctx, cursor));
        }
        cursor.gotoParent();
    }
    return issues;
}
