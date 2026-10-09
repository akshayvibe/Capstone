/**
 * Thin wrapper around web-tree-sitter that loads grammars, parses files,
 * and exposes a typed rule-evaluation context.
 */

import Parser from 'web-tree-sitter';
import type { SupportedLanguage } from './grammars.js';
import { extensionToLanguage, loadLanguage, isSupportedExtension } from './grammars.js';

export interface ParsedFile {
  readonly filePath: string;
  readonly language: SupportedLanguage;
  readonly source: string;
  readonly tree: Parser.Tree;
}

export interface ParseFailure {
  readonly filePath: string;
  readonly reason: string;
}

export interface ParseOptions {
  readonly maxFileBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024; // 1 MB

export async function parseFile(
  filePath: string,
  source: string,
  options: ParseOptions = {},
): Promise<ParsedFile | ParseFailure> {
  if (source.length > (options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)) {
    return { filePath, reason: 'file exceeds size budget' };
  }

  const language = extensionToLanguage(filePath);
  if (language === undefined) {
    return { filePath, reason: 'unsupported file extension' };
  }

  try {
    const lang = await loadLanguage(language);
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(source);
    return { filePath, language, source, tree };
  } catch (err: unknown) {
    return {
      filePath,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export { isSupportedExtension };
