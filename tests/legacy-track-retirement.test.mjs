import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const USER_FACING_TRACK_FILES = [
  '../src/helpers.js',
  '../src/learning-track.mjs',
  '../src/views/assessment.js',
  '../src/views/history.js',
  '../src/views/reading-list.js',
  '../src/views/stats.js'
];

test('user-facing article surfaces no longer expose a legacy graduate category', async () => {
  const sources = await Promise.all(USER_FACING_TRACK_FILES.map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  for (const source of sources) assert.doesNotMatch(source, /考研（旧版）/);

  const shelf = sources[4];
  const history = sources[3];
  const stats = sources[5];
  assert.doesNotMatch(shelf, /filterByDifficulty\('graduate'\)/);
  assert.doesNotMatch(history, /option value="graduate"/);
  assert.doesNotMatch(stats, /diffDist\.graduate/);
});
