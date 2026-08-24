import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertExamPack } from '../src/exam/pack.mjs';

test('every bundled private exam pack validates against the current schema', async () => {
  const index = JSON.parse(await readFile('public/exam-packs/private/index.json', 'utf8'));
  const results = await Promise.all(index.packs.map(async entry => {
    const pack = JSON.parse(await readFile(`public${entry.path}`, 'utf8'));
    await assertExamPack(pack);
    return pack.manifest.packageId;
  }));

  assert.deepEqual(results, index.packs.map(entry => entry.packageId));
});
