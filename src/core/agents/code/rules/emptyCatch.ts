/**
 * Flag empty catch blocks that silently swallow errors.
 */

import type Parser from 'web-tree-sitter';
import type { CodeRule, RuleContext } from './types.js';
import { createIssue } from './types.js';

export const emptyCatchRule: CodeRule = {
  id: 'empty-catch',
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

function traverse(ctx: RuleContext, cursor: Parser.TreeCursor): ReturnType<typeof createIssue>[] {
  const issues: ReturnType<typeof createIssue>[] = [];
  if (cursor.nodeType === 'catch_clause') {
    const body = cursor.currentNode.childForFieldName('body');
    if (body !== null && isEmptyBlock(body)) {
      issues.push(
        createIssue(
          emptyCatchRule,
          ctx,
          cursor.currentNode,
          'Empty catch block',
          'This catch block is empty and silently discards errors. Consider logging or re-throwing.',
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

function isEmptyBlock(node: Parser.SyntaxNode): boolean {
  const meaningfulStatements = node.namedChildren.filter((c) => c.type !== 'comment');
  return node.type === 'statement_block' && meaningfulStatements.length === 0;
}
