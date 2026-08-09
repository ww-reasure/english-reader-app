import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('wrong-review cards keep the summary compact and move question text into a detail dialog', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const view = await readFile(new URL('../src/views/exam-review.js', import.meta.url), 'utf8');
  assert.match(view, /exam-review-card-head/);
  assert.match(view, /exam-review-count/);
  assert.match(view, /data-review-details/);
  assert.match(view, /exam-review-dialog/);
  assert.match(view, /const groupKey = `\$\{group\.state\.bankId\}:\$\{group\.state\.paperKey\}:\$\{group\.state\.unitKey\}`/);
  assert.match(view, /exam-review-question-list/);
  assert.match(view, /exam-review-question-row/);
  assert.match(view, /showModal\(\)/);
  assert.match(css, /\.exam-review-panel \.exam-review-card\s*\{[^}]*display:\s*grid[^}]*gap:/s);
  assert.match(css, /\.exam-review-question-row\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,1fr\)/s);
  assert.match(css, /\.exam-review-card-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\.8fr\)\s+minmax\(0,1\.2fr\)/s);
  assert.match(css, /\.exam-review :focus-visible\s*\{[^}]*outline-color:\s*var\(--exam-accent\)/s);
});
