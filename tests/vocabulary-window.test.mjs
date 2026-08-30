import assert from 'node:assert/strict';
import test from 'node:test';

import { createVocabularyWindow } from '../src/vocabulary-window.mjs';

test('the vocabulary window renders at most 120 rows around the viewport', () => {
  const rows = Array.from({ length: 5000 }, (_, id) => ({ id }));
  const first = createVocabularyWindow(rows, { scrollTop: 0, viewportHeight: 720 });
  const middle = createVocabularyWindow(rows, { scrollTop: 240000, viewportHeight: 720 });

  assert.equal(first.start, 0);
  assert.ok(first.rows.length >= 60 && first.rows.length <= 120);
  assert.ok(middle.start > 0);
  assert.ok(middle.rows.length <= 120);
  assert.equal(middle.topSpacer + middle.rows.length * middle.estimatedRowHeight + middle.bottomSpacer, rows.length * middle.estimatedRowHeight);
});
