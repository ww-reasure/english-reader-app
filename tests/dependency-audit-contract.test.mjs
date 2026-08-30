import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('release dependency contract keeps Capacitor CLI in dev dependencies and pins the fixed brace expansion', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(packageJson.dependencies?.['@capacitor/cli'], undefined);
  assert.equal(packageJson.devDependencies?.['@capacitor/cli'], '8.4.2');
  assert.equal(packageJson.overrides?.['brace-expansion'], '5.0.9');
  assert.equal(packageJson.overrides?.nanoid, '3.3.17');
  assert.match(packageJson.scripts['security:audit'], /npm audit --omit=dev --audit-level=high/);
  assert.match(packageJson.scripts['security:audit'], /npm audit --audit-level=high/);
  assert.match(packageJson.scripts['release:preflight'], /security:audit/);
});
