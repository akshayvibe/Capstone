/**
 * Flag `==` and `!=` loose equality operators in favour of `===` / `!==`.
 */

import type Parser from 'web-tree-sitter';
import type { CodeRule, RuleContext } from './types.js';
import { createIssue } from './types.js';

export const looseEqualityRule: CodeRule = {
  id: 'loose-equality',
  category: 'code-quality',
  defaultSeverity: 'low',
  languages: ['typescript', 'tsx', 'javascript', 'jsx'],

  check(ctx: RuleContext) {
    const cursor = ctx.tree.walk();
    const issues = traverse(ctx, cursor);
    cursor.delete();
    return issues;
  },
};

function traverse(ctx: RuleContext, cursor: Parser.TreeCursor): ReturnType<typeof createIssue>[] {
  const issues: ReturnType<typeof createIssue>[] = [];
  if (cursor.nodeType === '==' || cursor.nodeType === '!=') {
    issues.push(
      createIssue(
        looseEqualityRule,
        ctx,
        cursor.currentNode,
        `Loose equality operator ${cursor.nodeType}`,
        `Use ${cursor.nodeType === '==' ? '===' : '!==' } instead of ${cursor.nodeType} to avoid type coercion.`,
      ),
    );
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
