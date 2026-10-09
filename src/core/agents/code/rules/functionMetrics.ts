/**
 * Simple function-level metrics: length, nesting depth, parameter count.
 */

import type Parser from 'web-tree-sitter';
import type { CodeRule, RuleContext } from './types.js';
import { createIssue } from './types.js';

export const functionMetricsRule: CodeRule = {
  id: 'function-metrics',
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

const FUNCTION_TYPES = new Set([
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
]);

function traverse(ctx: RuleContext, cursor: Parser.TreeCursor): ReturnType<typeof createIssue>[] {
  const issues: ReturnType<typeof createIssue>[] = [];
  if (FUNCTION_TYPES.has(cursor.nodeType)) {
    const node = cursor.currentNode;
    const name = node.childForFieldName('name')?.text ?? '(anonymous)';
    const body = node.childForFieldName('body');
    const parameters = node.childForFieldName('parameters');

    if (body !== null) {
      const startLine = body.startPosition.row;
      const endLine = body.endPosition.row;
      const length = endLine - startLine;
      if (length > 80) {
        issues.push(
          createIssue(
            functionMetricsRule,
            ctx,
            node,
            `Long function: ${name}`,
            `Function ${name} is ${length} lines long. Consider extracting helper functions.`,
          ),
        );
      }

      const maxDepth = computeMaxDepth(body);
      if (maxDepth > 4) {
        issues.push(
          createIssue(
            functionMetricsRule,
            ctx,
            node,
            `Deeply nested function: ${name}`,
            `Function ${name} has nesting depth ${maxDepth}. Consider flattening conditional logic.`,
          ),
        );
      }
    }

    if (parameters !== null) {
      const paramCount = parameters.namedChildren.length;
      if (paramCount > 5) {
        issues.push(
          createIssue(
            functionMetricsRule,
            ctx,
            node,
            `Too many parameters: ${name}`,
            `Function ${name} has ${paramCount} parameters. Consider accepting an options object.`,
          ),
        );
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

function computeMaxDepth(node: Parser.SyntaxNode): number {
  const BLOCK_LIKE = new Set([
    'statement_block',
    'if_statement',
    'for_statement',
    'for_in_statement',
    'while_statement',
    'do_statement',
    'switch_statement',
    'try_statement',
    'catch_clause',
  ]);

  let max = 0;
  function walk(current: Parser.SyntaxNode, depth: number): void {
    if (depth > max) max = depth;
    const nextDepth = BLOCK_LIKE.has(current.type) ? depth + 1 : depth;
    for (const child of current.children) {
      walk(child, nextDepth);
    }
  }
  walk(node, 0);
  return max;
}
