"use strict";
/**
 * Heuristic detection of floating promises: call expressions whose
 * callee looks async and which are used as standalone statements.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.floatingPromisesRule = void 0;
const types_js_1 = require("./types.js");
exports.floatingPromisesRule = {
    id: 'floating-promise',
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
    if (cursor.nodeType === 'call_expression') {
        const node = cursor.currentNode;
        if (isFloatingPromise(node)) {
            issues.push((0, types_js_1.createIssue)(exports.floatingPromisesRule, ctx, node, 'Floating promise', 'This async call is not awaited, returned, or chained with `.catch()`. Unhandled rejections may crash the process.'));
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
function isFloatingPromise(node) {
    if (node.type !== 'call_expression')
        return false;
    const parent = node.parent;
    if (parent === null)
        return false;
    // Must be a standalone statement.
    if (parent.type !== 'expression_statement')
        return false;
    const functionNode = node.childForFieldName('function');
    if (functionNode === null)
        return false;
    const calleeText = functionNode.text;
    // Heuristic: name ends with Async or starts with an async-looking prefix.
    const asyncByName = /Async$/.test(calleeText) || /^(fetch|axios|request)\b/.test(calleeText);
    if (!asyncByName)
        return false;
    // Exclude calls already chained with catch/then (simple check).
    const parentExpression = parent.parent;
    if (parentExpression !== null && parentExpression.type === 'member_expression') {
        return false;
    }
    return true;
}
