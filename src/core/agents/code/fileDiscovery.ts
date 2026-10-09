/**
 * Source-file discovery for the CodeAgent.
 *
 * Scans a root directory, applies ignore patterns compatible with
 * ProjectIndexer, and returns a bounded list of supported source files.
 */

import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { isSupportedExtension } from './parser/grammars.js';

export interface DiscoveryOptions {
  rootPath: string;
  maxFiles: number;
  /** Patterns that cause a file/directory to be skipped. */
  ignorePatterns?: readonly RegExp[];
  /** Files to prioritize (e.g. from RAG retrieved chunks). */
  priorityFiles?: readonly string[];
}

const DEFAULT_IGNORE_PATTERNS: RegExp[] = [
  /node_modules/,
  /\/dist\//,
  /\/dist-tests\//,
  /\/\.git\//,
  /\/coverage\//,
  /\.min\./,
  /\.d\.ts$/,
];

export async function discoverSourceFiles(options: DiscoveryOptions): Promise<string[]> {
  const normalizedPriority = new Set(
    (options.priorityFiles ?? []).map((p) => path.resolve(options.rootPath, p)),
  );

  const found: string[] = [];
  const ignored = new Set<string>();
  const patterns = options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS;

  async function walk(dir: string): Promise<void> {
    if (found.length >= options.maxFiles) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (found.length >= options.maxFiles) return;

      const fullPath = path.join(dir, entry.name);
      if (patterns.some((pattern) => pattern.test(fullPath))) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && isSupportedExtension(fullPath)) {
        found.push(fullPath);
      }
    }
  }

  await walk(options.rootPath);

  // Sort: priority files first, then alphabetical.
  found.sort((a, b) => {
    const aPriority = normalizedPriority.has(a);
    const bPriority = normalizedPriority.has(b);
    if (aPriority && !bPriority) return -1;
    if (!aPriority && bPriority) return 1;
    return a.localeCompare(b);
  });

  // Build ignored count for observability if needed; currently unused.
  void ignored;

  return found.slice(0, options.maxFiles);
}
