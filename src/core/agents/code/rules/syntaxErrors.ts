/**
 * Detect tree-sitter ERROR / MISSING nodes — i.e. syntax errors or
 * unparseable regions in the source file.
 */

import type Parser from 'web-tree-sitter';
import type { CodeRule, RuleContext } from './types.js';
import { createIssue } from './types.js';

export const syntaxErrorsRule: CodeRule = {
  id: 'syntax-error',
  category: 'bug',
  defaultSeverity: 'high',
  languages: [],

  check(ctx: RuleContext) {
    const issues = collectErrors(ctx, ctx.tree.rootNode);
    // Deduplicate by line to avoid flooding one broken file.
    const seen = new Set<number>();
    const unique: ReturnType<typeof createIssue>[] = [];
    for (const issue of issues) {
      const line = issue.location?.line ?? 0;
      if (!seen.has(line)) {
        seen.add(line);
        unique.push(issue);
      }
    }
    return unique;
  },
};

function collectErrors(ctx: RuleContext, node: Parser.SyntaxNode): ReturnType<typeof createIssue>[] {
  const issues: ReturnType<typeof createIssue>[] = [];
  if (node.isMissing || node.hasError) {
    const text = node.text.slice(0, 80);
    issues.push(
      createIssue(
        syntaxErrorsRule,
        ctx,
        node,
        node.isMissing ? 'Missing syntax node' : 'Syntax error',
        node.isMissing
          ? `Expected syntax is missing near "${text}".`
          : `Unexpected or invalid syntax near "${text}".`,
      ),
    );
  }
  for (const child of node.children) {
    issues.push(...collectErrors(ctx, child));
  }
  return issues;
}
