import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('exam word lookup is enabled by default and persists through Config', async () => {
  const source = await readFile(new URL('../src/config.js', import.meta.url), 'utf8');
  assert.match(source, /exam_word_lookup_enabled:\s*'true'/);
});

test('shared reading-style lookup accepts a dynamic enabled predicate', async () => {
  const source = await readFile(new URL('../src/components/reading-word-lookup.js', import.meta.url), 'utf8');
  assert.match(source, /isEnabled\s*=\s*\(\)\s*=>\s*true/);
  assert.match(source, /if \(!isEnabled\(\)\) return/);
});

test('global settings and the practice shortcut share the lookup preference', async () => {
  const [settingsSource, practiceSource, storageSource] = await Promise.all([
    readFile(new URL('../src/views/settings.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/config-storage.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(settingsSource, /settingsExamWordLookup/);
  assert.match(settingsSource, /role="switch"/);
  assert.match(settingsSource, /Config\.set\(['"]exam_word_lookup_enabled['"]/);
  assert.match(storageSource, /'exam_word_lookup_enabled'/);
  assert.match(practiceSource, /examWordLookupToggle/);
  assert.match(practiceSource, /toggleWordLookup\(\)/);
  assert.match(practiceSource, /Config\.set\(['"]exam_word_lookup_enabled['"]/);
  assert.match(practiceSource, /Config\.get\(['"]exam_word_lookup_enabled['"]\)\s*!==\s*['"]false['"]/);
  assert.match(practiceSource, /isEnabled:\s*this\.isExplanation\s*\?\s*\(\)\s*=>\s*true\s*:\s*\(\)\s*=>\s*this\.wordLookupEnabled/);
  assert.match(practiceSource, /allowAskAI:\s*true/);
});
