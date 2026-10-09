/**
 * Flag leftover `console.*` debugging statements.
 */

import path from 'node:path';
import type Parser from 'web-tree-sitter';
import type { CodeRule, RuleContext } from './types.js';
import { createIssue } from './types.js';

export const consoleStatementsRule: CodeRule = {
  id: 'console-statement',
  category: 'code-quality',
  defaultSeverity: 'info',
  languages: ['typescript', 'tsx', 'javascript', 'jsx'],

  check(ctx: RuleContext) {
    const cursor = ctx.tree.walk();
    const issues = traverse(ctx, cursor);
    cursor.delete();
    return issues;
  },
};

function traverse(ctx: RuleContext, cursor: Parser.TreeCursor): ReturnType<typeof createIssue>[] {
  // CLI files legitimately use console.* for user-facing output.
  if (ctx.filePath.includes(`${path.sep}cli${path.sep}`)) return [];

  const issues: ReturnType<typeof createIssue>[] = [];
  if (cursor.nodeType === 'member_expression' || cursor.nodeType === 'call_expression') {
    const node = cursor.currentNode;
    const text = node.text;
    if (/\bconsole\.(log|warn|error|debug|info|table)\s*\(/.test(text)) {
      issues.push(
        createIssue(
          consoleStatementsRule,
          ctx,
          node,
          'Console debugging statement',
          'Remove or replace debugging console statements before committing.',
        ),
      );
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
