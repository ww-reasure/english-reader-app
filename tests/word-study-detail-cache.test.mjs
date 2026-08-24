import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('word detail uses versioned cache snapshots before remote material enrichment', async () => {
  const [source, db] = await Promise.all([
    readFile(new URL('../src/components/word-study-detail.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/db.js', import.meta.url), 'utf8')
  ]);
  assert.match(source, /WordStudyDetailCache/);
  assert.match(source, /loadCachedDetail/);
  assert.match(source, /persistDetailCache/);
  assert.match(source, /materialStages\.examples/);
  assert.match(source, /materialStages\.root/);
  assert.match(db, /DB_VERSION: 18/);
  assert.match(db, /aiCache/);
});

test('word detail keeps lazy phrase and synonym requests separate from the initial load', async () => {
  const source = await readFile(new URL('../src/components/word-study-detail.js', import.meta.url), 'utf8');
  assert.match(source, /tab === 'phrases' && this\.phrases\.status === 'idle'/);
  assert.match(source, /tab === 'similar' && this\.similar\.status === 'idle'/);
  assert.match(source, /WordStudyDetailCache\.update/);
  assert.match(source, /this\.isCurrent\(session, word\)/);
});
