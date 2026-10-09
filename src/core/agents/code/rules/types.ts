/**
 * Code analysis rule types.
 */

import type Parser from 'web-tree-sitter';
import type { AgentIssue, Severity } from '../../../../types/index.js';
import type { SupportedLanguage } from '../parser/grammars.js';

export interface RuleContext {
  readonly filePath: string;
  readonly language: SupportedLanguage;
  readonly source: string;
  readonly tree: Parser.Tree;
}

export interface CodeRule {
  readonly id: string;
  readonly category: AgentIssue['category'];
  readonly defaultSeverity: Severity;
  /** Which languages this rule applies to. Empty array = all supported. */
  readonly languages: SupportedLanguage[];
  check(ctx: RuleContext): AgentIssue[];
}

export function createIssue(
  rule: Pick<CodeRule, 'id' | 'category' | 'defaultSeverity'>,
  ctx: RuleContext,
  node: Parser.SyntaxNode,
  title: string,
  message: string,
  overrides?: { severity?: Severity; remediation?: string },
): AgentIssue {
  const start = node.startPosition;
  const end = node.endPosition;
  return {
    id: `${rule.id}:${ctx.filePath}:${start.row + 1}:${start.column}`,
    ruleId: rule.id,
    title,
    message,
    severity: overrides?.severity ?? rule.defaultSeverity,
    category: rule.category,
    location: {
      filePath: ctx.filePath,
      line: start.row + 1,
      column: start.column + 1,
      endLine: end.row + 1,
      endColumn: end.column + 1,
    },
    evidence: ctx.source.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 300)),
    remediation: overrides?.remediation,
  };
}
