/**
 * Static code analysis agent powered by tree-sitter.
 *
 * Discovers supported source files, parses them with web-tree-sitter,
 * and runs a registry of AST-based rules to detect bugs, logical issues,
 * and code-quality problems.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentPayload, AgentReport, AgentIssue } from '../../../types/index.js';
import { BaseAgent } from '../base/BaseAgent.js';
import { emptyReport, addIssue, addToolUnavailable, attachRawEvidence, formatSummary } from '../report.js';
import { parseFile } from './parser/TreeSitterParser.js';
import { discoverSourceFiles } from './fileDiscovery.js';
import { codeRules } from './rules/index.js';

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

export class CodeAgent extends BaseAgent {
  public readonly name = 'CodeAgent';
  public readonly intent = 'analyze' as const;

  protected async run(payload: AgentPayload): Promise<{ success: boolean; summary: string; data: AgentReport }> {
    const report = emptyReport(this.name, this.intent);
    const rootPath = process.cwd();
    const maxFiles = parsePositiveInt(process.env['HELIX_CODE_MAX_FILES'], DEFAULT_MAX_FILES);

    const priorityFiles = payload.context?.retrievedChunks.map((chunk) => chunk.filePath) ?? [];

    let filePaths: string[];
    try {
      filePaths = await discoverSourceFiles({ rootPath, maxFiles, priorityFiles });
    } catch (err: unknown) {
      return {
        success: false,
        summary: `Could not discover source files: ${err instanceof Error ? err.message : String(err)}`,
        data: report,
      };
    }

    const parseFailures: string[] = [];
    let parsedCount = 0;

    for (const filePath of filePaths) {
      let source: string;
      try {
        source = await fs.readFile(filePath, 'utf8');
      } catch (err: unknown) {
        parseFailures.push(`${path.relative(rootPath, filePath)}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      const parsed = await parseFile(filePath, source, { maxFileBytes: DEFAULT_MAX_FILE_BYTES });
      if ('reason' in parsed) {
        parseFailures.push(`${path.relative(rootPath, filePath)}: ${parsed.reason}`);
        addIssue(report, {
          id: `${this.name}:parse-failure:${filePath}`,
          ruleId: 'parse-failure',
          title: 'Could not parse file',
          message: parsed.reason,
          severity: 'info',
          category: 'code-quality',
          location: { filePath },
          evidence: parsed.reason,
        });
        continue;
      }

      parsedCount += 1;
      for (const rule of codeRules) {
        if (rule.languages.length > 0 && !rule.languages.includes(parsed.language)) continue;
        try {
          const ruleIssues = rule.check(parsed);
          for (const issue of ruleIssues) {
            addIssue(report, issue);
          }
        } catch (err: unknown) {
          addIssue(report, {
            id: `${this.name}:rule-error:${rule.id}:${filePath}`,
            ruleId: 'rule-error',
            title: `Rule ${rule.id} failed`,
            message: err instanceof Error ? err.message : String(err),
            severity: 'info',
            category: 'code-quality',
            location: { filePath },
            evidence: err instanceof Error ? err.message : String(err),
          });
        }
      }

      parsed.tree.delete();
    }

    report.filesScanned = parsedCount;

    if (parseFailures.length > 0) {
      attachRawEvidence(report, { parseFailures }, payload.options.verbose);
    }

    if (parsedCount === 0 && filePaths.length > 0) {
      addToolUnavailable(report, 'tree-sitter', 'No source files could be parsed; check grammar files are present.');
    }

    return {
      success: true,
      summary: formatSummary(report),
      data: report,
    };
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) return fallback;
  return parsed;
}
