import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('release builds preserve the Vite application entry instead of copying the legacy public entry', () => {
  const projectRoot = resolve(import.meta.dirname, '..');
  execFileSync(process.execPath, [resolve(projectRoot, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'public'], {
    cwd: projectRoot,
    stdio: 'ignore'
  });
  const html = readFileSync(resolve(projectRoot, 'www/index.html'), 'utf8');
  assert.match(html, /skip-link/);
  assert.doesNotMatch(html, /Bottom Tab Navigation|js\/app\.js/);
});
