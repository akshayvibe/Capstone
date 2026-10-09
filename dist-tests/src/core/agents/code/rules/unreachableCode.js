"use strict";
/**
 * Detect statements that follow an unconditional terminator
 * (return, throw, break, continue) in the same block.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.unreachableCodeRule = void 0;
const types_js_1 = require("./types.js");
exports.unreachableCodeRule = {
    id: 'unreachable-code',
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
const TERMINATORS = new Set(['return_statement', 'throw_statement', 'break_statement', 'continue_statement']);
function traverse(ctx, cursor) {
    const issues = [];
    if (cursor.nodeType === 'statement_block' || cursor.nodeType === 'program') {
        const node = cursor.currentNode;
        const children = node.children.filter((c) => c.isNamed);
        let terminated = false;
        for (const child of children) {
            if (terminated) {
                issues.push((0, types_js_1.createIssue)(exports.unreachableCodeRule, ctx, child, 'Unreachable code', 'This statement follows an unconditional return/throw/break/continue and will never execute.'));
            }
            if (TERMINATORS.has(child.type)) {
                terminated = true;
            }
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
