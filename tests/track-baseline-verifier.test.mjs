import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('ships a repeatable target-track provenance verifier rather than relying on a maintainer checklist', () => {
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  assert.equal(packageJson.scripts['track-baseline:verify'], 'node scripts/verify-track-baselines.mjs');

  const result = spawnSync(process.execPath, ['scripts/verify-track-baselines.mjs'], {
    cwd: resolve('.'),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /target-track baseline: disabled/i);
  assert.match(result.stdout, /blocked target-focus tracks: cet4, cet6, kaoyan1, kaoyan2/i);
});
