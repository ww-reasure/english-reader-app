import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styleSource = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');

test('chat image surfaces have explicit scoped selectors', () => {
  assert.match(styleSource, /\.chat-image-draft-strip/);
  assert.match(styleSource, /\.chat-image-message-grid/);
  assert.match(styleSource, /\.chat-image-viewer/);
  assert.match(styleSource, /\.chat-image-action-sheet/);
});

test('chat image layout is bounded and horizontally scrollable', () => {
  assert.match(styleSource, /\.chat-image-draft-strip[\s\S]*overflow-x:\s*auto/);
  assert.match(styleSource, /\.chat-container[\s\S]*overflow-x:\s*(?:clip|hidden)/);
  assert.match(styleSource, /:focus-visible/);
  assert.match(styleSource, /@media\s*\([^)]*min-width:\s*840px/);
});

test('active image context and viewer controls have explicit accessible layout', () => {
  assert.match(styleSource, /\.chat-active-image-chip\s*\{/);
  assert.match(styleSource, /\.chat-image-viewer-stage\s*\{/);
  assert.match(styleSource, /\.chat-image-viewer-toolbar\s*\{/);
  assert.match(styleSource, /\.chat-image-viewer-continue\s*\{/);
});
