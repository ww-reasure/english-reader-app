import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const buildAssetsDirectory = fileURLToPath(new URL('../www/assets/', import.meta.url));

test('production build emits the grammar worker as an external self-contained module', async () => {
  const assetNames = await readdir(buildAssetsDirectory);
  const scriptNames = assetNames.filter(name => name.endsWith('.js'));
  const scripts = await Promise.all(scriptNames.map(async name => ({
    name,
    source: await readFile(join(buildAssetsDirectory, name), 'utf8')
  })));
  const joinedOutput = scripts.map(script => script.source).join('\n');
  const worker = scripts.find(script => script.name.startsWith('grammar-analyzer.worker-'));

  assert.ok(worker, 'Vite must emit a named external grammar worker chunk');
  assert.doesNotMatch(joinedOutput, /data:text\/javascript;base64,/,
    'a module worker cannot resolve its relative imports from an inlined data: URL');
  assert.doesNotMatch(worker.source, /from\s*['"]\.\//,
    'the emitted worker must bundle its runtime dependencies instead of retaining relative imports');
});
