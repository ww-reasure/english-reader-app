import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('configures native safe-area CSS injection and the Android back-button plugin', async () => {
  const [config, packageJson] = await Promise.all([
    readFile(new URL('../capacitor.config.json', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8')
  ]);
  assert.match(config, /"SystemBars"\s*:\s*\{\s*"insetsHandling"\s*:\s*"css"/s);
  assert.match(packageJson, /"@capacitor\/app"\s*:/);
});
