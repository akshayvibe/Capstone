/**
 * Heuristic detection of floating promises: call expressions whose
 * callee looks async and which are used as standalone statements.
 */

import type Parser from 'web-tree-sitter';
import type { CodeRule, RuleContext } from './types.js';
import { createIssue } from './types.js';

export const floatingPromisesRule: CodeRule = {
  id: 'floating-promise',
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
  if (cursor.nodeType === 'call_expression') {
    const node = cursor.currentNode;
    if (isFloatingPromise(node)) {
      issues.push(
        createIssue(
          floatingPromisesRule,
          ctx,
          node,
          'Floating promise',
          'This async call is not awaited, returned, or chained with `.catch()`. Unhandled rejections may crash the process.',
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

function isFloatingPromise(node: Parser.SyntaxNode): boolean {
  if (node.type !== 'call_expression') return false;
  const parent = node.parent;
  if (parent === null) return false;
  // Must be a standalone statement.
  if (parent.type !== 'expression_statement') return false;

  const functionNode = node.childForFieldName('function');
  if (functionNode === null) return false;

  const calleeText = functionNode.text;
  // Heuristic: name ends with Async or starts with an async-looking prefix.
  const asyncByName = /Async$/.test(calleeText) || /^(fetch|axios|request)\b/.test(calleeText);
  if (!asyncByName) return false;

  // Exclude calls already chained with catch/then (simple check).
  const parentExpression = parent.parent;
  if (parentExpression !== null && parentExpression.type === 'member_expression') {
    return false;
  }

  return true;
}
