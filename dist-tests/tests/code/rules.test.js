"use strict";
/**
 * Tests for CodeAgent AST rules.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const TreeSitterParser_js_1 = require("../../src/core/agents/code/parser/TreeSitterParser.js");
const index_js_1 = require("../../src/core/agents/code/rules/index.js");
async function parseFixture(name) {
    const filePath = node_path_1.default.resolve('tests/fixtures/code-samples', name);
    const source = await promises_1.default.readFile(filePath, 'utf8');
    const parsed = await (0, TreeSitterParser_js_1.parseFile)(filePath, source);
    if ('reason' in parsed) {
        throw new Error(parsed.reason);
    }
    return parsed;
}
function ruleIds(ctx) {
    const ids = [];
    for (const rule of index_js_1.codeRules) {
        if (rule.languages.length > 0 && !rule.languages.includes(ctx.language))
            continue;
        ids.push(...rule.check(ctx).map((i) => i.ruleId));
    }
    return ids;
}
(0, node_test_1.describe)('CodeAgent rules', () => {
    (0, node_test_1.it)('detects loose equality', async () => {
        const ctx = await parseFixture('looseEquality.ts');
        const ids = ruleIds(ctx);
        strict_1.default.ok(ids.includes('loose-equality'));
        ctx.tree.delete();
    });
    (0, node_test_1.it)('detects empty catch blocks', async () => {
        const ctx = await parseFixture('emptyCatch.ts');
        const ids = ruleIds(ctx);
        strict_1.default.ok(ids.includes('empty-catch'));
        ctx.tree.delete();
    });
    (0, node_test_1.it)('detects var and console statements', async () => {
        const ctx = await parseFixture('varAndConsole.ts');
        const ids = ruleIds(ctx);
        strict_1.default.ok(ids.includes('var-usage'));
        strict_1.default.ok(ids.includes('console-statement'));
        ctx.tree.delete();
    });
    (0, node_test_1.it)('detects any type annotations in TypeScript', async () => {
        const ctx = await parseFixture('anyType.ts');
        const ids = ruleIds(ctx);
        strict_1.default.ok(ids.includes('any-type'));
        ctx.tree.delete();
    });
    (0, node_test_1.it)('produces no issues for a clean sample', async () => {
        const ctx = await parseFixture('clean.ts');
        const ids = ruleIds(ctx);
        strict_1.default.deepEqual(ids, []);
        ctx.tree.delete();
    });
});
