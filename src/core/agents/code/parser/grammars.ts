/**
 * Grammar resolution for web-tree-sitter.
 *
 * Maps file extensions to prebuilt WASM grammar files shipped by
 * `tree-sitter-wasms`. All grammars are loaded lazily and cached.
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import Parser from 'web-tree-sitter';

// Resolve the grammar directory via Node module resolution so the path is
// correct regardless of whether this file runs from src/, dist/, or dist-tests/.
const nodeRequire = createRequire(__filename);
const GRAMMAR_DIR = path.dirname(
  nodeRequire.resolve('tree-sitter-wasms/out/tree-sitter-typescript.wasm'),
);

export type SupportedLanguage = 'typescript' | 'tsx' | 'javascript' | 'jsx';

export function extensionToLanguage(filePath: string): SupportedLanguage | undefined {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
      return 'javascript';
    case '.jsx':
      return 'jsx';
    default:
      return undefined;
  }
}

const grammarFileName: Record<SupportedLanguage, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  jsx: 'tree-sitter-javascript.wasm',
};

const languageCache = new Map<SupportedLanguage, Parser.Language>();

export async function loadLanguage(language: SupportedLanguage): Promise<Parser.Language> {
  const cached = languageCache.get(language);
  if (cached) return cached;

  await Parser.init();
  const wasmPath = path.join(GRAMMAR_DIR, grammarFileName[language]);
  const lang = await Parser.Language.load(wasmPath);
  languageCache.set(language, lang);
  return lang;
}

export function isSupportedExtension(filePath: string): boolean {
  return extensionToLanguage(filePath) !== undefined;
}
