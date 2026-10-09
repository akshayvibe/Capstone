"use strict";
/**
 * Flag explicit `any` type annotations in TypeScript sources.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.anyTypeRule = void 0;
const types_js_1 = require("./types.js");
exports.anyTypeRule = {
    id: 'any-type',
    category: 'code-quality',
    defaultSeverity: 'low',
    languages: ['typescript', 'tsx'],
    check(ctx) {
        const cursor = ctx.tree.walk();
        const issues = traverse(ctx, cursor);
        cursor.delete();
        return issues;
    },
};
function traverse(ctx, cursor) {
    const issues = [];
    if (cursor.nodeType === 'predefined_type' && cursor.currentNode.text === 'any') {
        issues.push((0, types_js_1.createIssue)(exports.anyTypeRule, ctx, cursor.currentNode, 'Explicit any type', 'Avoid using `any`; prefer a concrete type or `unknown` with runtime checks.'));
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
