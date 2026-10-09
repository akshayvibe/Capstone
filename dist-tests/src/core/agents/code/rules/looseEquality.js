"use strict";
/**
 * Flag `==` and `!=` loose equality operators in favour of `===` / `!==`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.looseEqualityRule = void 0;
const types_js_1 = require("./types.js");
exports.looseEqualityRule = {
    id: 'loose-equality',
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
    if (cursor.nodeType === '==' || cursor.nodeType === '!=') {
        issues.push((0, types_js_1.createIssue)(exports.looseEqualityRule, ctx, cursor.currentNode, `Loose equality operator ${cursor.nodeType}`, `Use ${cursor.nodeType === '==' ? '===' : '!=='} instead of ${cursor.nodeType} to avoid type coercion.`));
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
