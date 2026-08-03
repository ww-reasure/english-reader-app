import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readFileText(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('Android activity remains rotatable and resizeable for tablet and multi-window use', async () => {
  const manifest = await readFileText('../android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:resizeableActivity="true"/);
  assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
  assert.match(manifest, /android:configChanges="[^\"]*orientation[^\"]*screenSize[^\"]*smallestScreenSize[^\"]*screenLayout/);
  assert.doesNotMatch(manifest, /android:screenOrientation="(?:portrait|landscape)"/);
});

test('web viewport is safe-area aware for cutouts and gesture bars', async () => {
  const html = await readFileText('../index.html');
  const css = await readFileText('../css/style.css');
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /--safe-area-inset-(?:left|right)/);
});
