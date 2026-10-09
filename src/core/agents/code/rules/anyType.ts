/**
 * Flag explicit `any` type annotations in TypeScript sources.
 */

import type Parser from 'web-tree-sitter';
import type { CodeRule, RuleContext } from './types.js';
import { createIssue } from './types.js';

export const anyTypeRule: CodeRule = {
  id: 'any-type',
  category: 'code-quality',
  defaultSeverity: 'low',
  languages: ['typescript', 'tsx'],

  check(ctx: RuleContext) {
    const cursor = ctx.tree.walk();
    const issues = traverse(ctx, cursor);
    cursor.delete();
    return issues;
  },
};

function traverse(ctx: RuleContext, cursor: Parser.TreeCursor): ReturnType<typeof createIssue>[] {
  const issues: ReturnType<typeof createIssue>[] = [];
  if (cursor.nodeType === 'predefined_type' && cursor.currentNode.text === 'any') {
    issues.push(
      createIssue(
        anyTypeRule,
        ctx,
        cursor.currentNode,
        'Explicit any type',
        'Avoid using `any`; prefer a concrete type or `unknown` with runtime checks.',
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
