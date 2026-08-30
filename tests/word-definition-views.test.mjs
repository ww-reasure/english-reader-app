import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('word-definition UI uses shared senses, phonetics, and lazy saved-word enrichment', async () => {
  const [tooltip, vocabulary, flashcard, css] = await Promise.all([
    read('../src/components/tooltip.js'),
    read('../src/views/vocabulary.js'),
    read('../src/views/flashcard.js'),
    read('../css/style.css')
  ]);

  assert.match(tooltip, /getDefinitionPreview/);
  assert.match(tooltip, /formatPhonetic/);
  assert.match(tooltip, /tooltip-definition-toggle/);
  assert.match(tooltip, /tooltip-lexical-meta/);
  assert.match(tooltip, /tooltip-word-trigger/);
  assert.match(tooltip, /tooltip-phonetic-trigger/);
  assert.match(tooltip, /data-audio-word/);
  assert.match(tooltip, /querySelectorAll\('\[data-audio-word\]'\)/);
  assert.doesNotMatch(tooltip, /tooltip-audio-button/);
  assert.match(tooltip, /definitionSenses/);

  assert.match(vocabulary, /ensureSavedWordDefinition/);
  assert.match(vocabulary, /updateWordDefinition/);
  assert.match(flashcard, /ensureSavedWordDefinition/);
  assert.match(flashcard, /currentDefinitionLines/);

  assert.match(css, /\.vocab-translation\s*\{[^}]*-webkit-line-clamp:2/s);
  assert.match(css, /\.tooltip-definition-toggle/);
  assert.match(css, /\.tooltip-all-definitions\[hidden\]\s*\{\s*display:none/);
  assert.match(css, /\.tooltip-lexical-meta\s*\{[^}]*justify-content:flex-start/s);
  assert.match(css, /\.tooltip-word-trigger/);
  assert.match(css, /\.tooltip-phonetic-trigger/);
  assert.doesNotMatch(css, /\.tooltip-audio-button/);
  assert.match(css, /\.definition-line/);
});
