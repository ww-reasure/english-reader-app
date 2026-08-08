import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('Review Center preserves the stable reading question number when question.number is absent', async () => {
  const source = await readFile(new URL('../src/views/exam-review.js', import.meta.url), 'utf8');
  const functionSource = source.match(/function questionLabel\(unit, question, index\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(functionSource, 'questionLabel helper should remain directly testable');
  const questionLabel = Function(`${functionSource}; return questionLabel;`)();

  assert.equal(
    questionLabel(
      { type: 'reading_mcq' },
      { questionKey: 'synthetic_kaoyan_2026_q22' },
      1
    ),
    'Q22'
  );
});
