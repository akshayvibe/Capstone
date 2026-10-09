/**
 * Tests for CodeAgent AST rules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from '../../src/core/agents/code/parser/TreeSitterParser.js';
import { codeRules } from '../../src/core/agents/code/rules/index.js';
import type { RuleContext } from '../../src/core/agents/code/rules/types.js';

async function parseFixture(name: string): Promise<RuleContext> {
  const filePath = path.resolve('tests/fixtures/code-samples', name);
  const source = await fs.readFile(filePath, 'utf8');
  const parsed = await parseFile(filePath, source);
  if ('reason' in parsed) {
    throw new Error(parsed.reason);
  }
  return parsed;
}

function ruleIds(ctx: RuleContext): string[] {
  const ids: string[] = [];
  for (const rule of codeRules) {
    if (rule.languages.length > 0 && !rule.languages.includes(ctx.language)) continue;
    ids.push(...rule.check(ctx).map((i) => i.ruleId));
  }
  return ids;
}

describe('CodeAgent rules', () => {
  it('detects loose equality', async () => {
    const ctx = await parseFixture('looseEquality.ts');
    const ids = ruleIds(ctx);
    assert.ok(ids.includes('loose-equality'));
    ctx.tree.delete();
  });

  it('detects empty catch blocks', async () => {
    const ctx = await parseFixture('emptyCatch.ts');
    const ids = ruleIds(ctx);
    assert.ok(ids.includes('empty-catch'));
    ctx.tree.delete();
  });

  it('detects var and console statements', async () => {
    const ctx = await parseFixture('varAndConsole.ts');
    const ids = ruleIds(ctx);
    assert.ok(ids.includes('var-usage'));
    assert.ok(ids.includes('console-statement'));
    ctx.tree.delete();
  });

  it('detects any type annotations in TypeScript', async () => {
    const ctx = await parseFixture('anyType.ts');
    const ids = ruleIds(ctx);
    assert.ok(ids.includes('any-type'));
    ctx.tree.delete();
  });

  it('produces no issues for a clean sample', async () => {
    const ctx = await parseFixture('clean.ts');
    const ids = ruleIds(ctx);
    assert.deepEqual(ids, []);
    ctx.tree.delete();
  });
});
