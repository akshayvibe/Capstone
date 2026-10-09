"use strict";
/**
 * Tests for the shared safe command executor.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const exec_js_1 = require("../src/utils/exec.js");
(0, node_test_1.describe)('execCommand', () => {
    (0, node_test_1.it)('returns success for a valid command', async () => {
        const result = await (0, exec_js_1.execCommand)('node', { args: ['--version'], timeoutMs: 5_000 });
        strict_1.default.equal(result.ok, true);
        if (result.ok) {
            strict_1.default.match(result.stdout, /v\d+/);
            strict_1.default.equal(result.exitCode, 0);
        }
    });
    (0, node_test_1.it)('classifies a missing command as not-found', async () => {
        const result = await (0, exec_js_1.execCommand)('definitely-not-a-real-command-xyz', {
            args: ['--version'],
            timeoutMs: 5_000,
        });
        strict_1.default.equal(result.ok, false);
        if (!result.ok) {
            strict_1.default.equal(result.kind, 'not-found');
        }
    });
    (0, node_test_1.it)('permits a configured non-zero exit code', async () => {
        const result = await (0, exec_js_1.execCommand)('node', {
            args: ['-e', 'process.exit(1)'],
            permitNonZeroExit: [1],
            timeoutMs: 5_000,
        });
        strict_1.default.equal(result.ok, true);
        if (result.ok) {
            strict_1.default.equal(result.exitCode, 1);
        }
    });
    (0, node_test_1.it)('reports an unexpected non-zero exit as exit-error', async () => {
        const result = await (0, exec_js_1.execCommand)('node', {
            args: ['-e', 'process.exit(2)'],
            timeoutMs: 5_000,
        });
        strict_1.default.equal(result.ok, false);
        if (!result.ok) {
            strict_1.default.equal(result.kind, 'exit-error');
            strict_1.default.equal(result.exitCode, 2);
        }
    });
});
