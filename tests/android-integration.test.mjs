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

test('keeps the Capacitor app identity aligned with the installed Android application id', async () => {
  const [configSource, buildGradle] = await Promise.all([
    readFile(new URL('../capacitor.config.json', import.meta.url), 'utf8'),
    readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8')
  ]);
  const config = JSON.parse(configSource);
  const applicationId = buildGradle.match(/applicationId\s+["']([^"']+)["']/)?.[1];

  assert.ok(applicationId);
  assert.equal(config.appId, applicationId);
});
