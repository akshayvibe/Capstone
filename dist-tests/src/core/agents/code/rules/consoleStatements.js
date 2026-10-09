"use strict";
/**
 * Flag leftover `console.*` debugging statements.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.consoleStatementsRule = void 0;
const node_path_1 = __importDefault(require("node:path"));
const types_js_1 = require("./types.js");
exports.consoleStatementsRule = {
    id: 'console-statement',
    category: 'code-quality',
    defaultSeverity: 'info',
    languages: ['typescript', 'tsx', 'javascript', 'jsx'],
    check(ctx) {
        const cursor = ctx.tree.walk();
        const issues = traverse(ctx, cursor);
        cursor.delete();
        return issues;
    },
};
function traverse(ctx, cursor) {
    // CLI files legitimately use console.* for user-facing output.
    if (ctx.filePath.includes(`${node_path_1.default.sep}cli${node_path_1.default.sep}`))
        return [];
    const issues = [];
    if (cursor.nodeType === 'member_expression' || cursor.nodeType === 'call_expression') {
        const node = cursor.currentNode;
        const text = node.text;
        if (/\bconsole\.(log|warn|error|debug|info|table)\s*\(/.test(text)) {
            issues.push((0, types_js_1.createIssue)(exports.consoleStatementsRule, ctx, node, 'Console debugging statement', 'Remove or replace debugging console statements before committing.'));
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
