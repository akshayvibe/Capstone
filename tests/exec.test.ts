/**
 * Tests for the shared safe command executor.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execCommand } from '../src/utils/exec.js';

describe('execCommand', () => {
  it('returns success for a valid command', async () => {
    const result = await execCommand('node', { args: ['--version'], timeoutMs: 5_000 });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.stdout, /v\d+/);
      assert.equal(result.exitCode, 0);
    }
  });

  it('classifies a missing command as not-found', async () => {
    const result = await execCommand('definitely-not-a-real-command-xyz', {
      args: ['--version'],
      timeoutMs: 5_000,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.kind, 'not-found');
    }
  });

  it('permits a configured non-zero exit code', async () => {
    const result = await execCommand('node', {
      args: ['-e', 'process.exit(1)'],
      permitNonZeroExit: [1],
      timeoutMs: 5_000,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.exitCode, 1);
    }
  });

  it('reports an unexpected non-zero exit as exit-error', async () => {
    const result = await execCommand('node', {
      args: ['-e', 'process.exit(2)'],
      timeoutMs: 5_000,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.kind, 'exit-error');
      assert.equal(result.exitCode, 2);
    }
  });
});
