"use strict";
/**
 * Flag empty catch blocks that silently swallow errors.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyCatchRule = void 0;
const types_js_1 = require("./types.js");
exports.emptyCatchRule = {
    id: 'empty-catch',
    category: 'bug',
    defaultSeverity: 'medium',
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
    if (cursor.nodeType === 'catch_clause') {
        const body = cursor.currentNode.childForFieldName('body');
        if (body !== null && isEmptyBlock(body)) {
            issues.push((0, types_js_1.createIssue)(exports.emptyCatchRule, ctx, cursor.currentNode, 'Empty catch block', 'This catch block is empty and silently discards errors. Consider logging or re-throwing.'));
        }
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
function isEmptyBlock(node) {
    const meaningfulStatements = node.namedChildren.filter((c) => c.type !== 'comment');
    return node.type === 'statement_block' && meaningfulStatements.length === 0;
}
