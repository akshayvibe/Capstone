/**
 * Detect statements that follow an unconditional terminator
 * (return, throw, break, continue) in the same block.
 */

import type Parser from 'web-tree-sitter';
import type { CodeRule, RuleContext } from './types.js';
import { createIssue } from './types.js';

export const unreachableCodeRule: CodeRule = {
  id: 'unreachable-code',
  category: 'bug',
  defaultSeverity: 'medium',
  languages: ['typescript', 'tsx', 'javascript', 'jsx'],

  check(ctx: RuleContext) {
    const cursor = ctx.tree.walk();
    const issues = traverse(ctx, cursor);
    cursor.delete();
    return issues;
  },
};

const TERMINATORS = new Set(['return_statement', 'throw_statement', 'break_statement', 'continue_statement']);

function traverse(ctx: RuleContext, cursor: Parser.TreeCursor): ReturnType<typeof createIssue>[] {
  const issues: ReturnType<typeof createIssue>[] = [];
  if (cursor.nodeType === 'statement_block' || cursor.nodeType === 'program') {
    const node = cursor.currentNode;
    const children = node.children.filter((c) => c.isNamed);
    let terminated = false;
    for (const child of children) {
      if (terminated) {
        issues.push(
          createIssue(
            unreachableCodeRule,
            ctx,
            child,
            'Unreachable code',
            'This statement follows an unconditional return/throw/break/continue and will never execute.',
          ),
        );
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
