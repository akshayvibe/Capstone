/**
 * Flag `var` declarations in favour of `let` or `const`.
 */

import type Parser from 'web-tree-sitter';
import type { CodeRule, RuleContext } from './types.js';
import { createIssue } from './types.js';

export const varUsageRule: CodeRule = {
  id: 'var-usage',
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
  if (cursor.nodeType === 'var') {
    issues.push(
      createIssue(
        varUsageRule,
        ctx,
        cursor.currentNode,
        'Use of var declaration',
        'Prefer `const` or `let` over `var` to avoid function-scoping surprises.',
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
