import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createReviewSessionMetrics } from '../src/review-session-metrics.mjs';
import * as reviewSessionMetricsModule from '../src/review-session-metrics.mjs';

test('keeps the original deduplicated total while recording reinserted ratings', () => {
  const metrics = createReviewSessionMetrics({ originalWordIds: [7, 8, 7] });

  metrics.recordRating({ attemptId: 'seven-first', wordId: 7, quality: 3 });
  metrics.recordRating({ attemptId: 'eight', wordId: 8, quality: 5 });
  metrics.recordRating({ attemptId: 'seven-reinserted', wordId: 7, quality: 5 });

  assert.deepEqual(metrics.summary(), {
    total: 2,
    mastered: 2,
    masteryRate: 100,
    known: 1,
    uncertain: 1,
    unknown: 0,
    rated: 2
  });
});

test('uses each word\'s weakest rating for results but any known rating for mastery', () => {
  const metrics = createReviewSessionMetrics({ originalWordIds: [1, 2, 3] });

  metrics.recordRating({ attemptId: 'one-weak', wordId: 1, quality: 3 });
  metrics.recordRating({ attemptId: 'one-known', wordId: 1, quality: 5 });
  metrics.recordRating({ attemptId: 'two-forgot', wordId: 2, quality: 1 });
  metrics.recordRating({ attemptId: 'two-known', wordId: 2, quality: 5 });

  assert.deepEqual(metrics.summary(), {
    total: 3,
    mastered: 2,
    masteryRate: 67,
    known: 0,
    uncertain: 1,
    unknown: 1,
    rated: 2
  });
  assert.deepEqual(metrics.getWordResult(1), { weakestQuality: 3, lastQuality: 5, mastered: true });
  assert.deepEqual(metrics.getWordResult(2), { weakestQuality: 1, lastQuality: 5, mastered: true });
  assert.equal(metrics.getWordResult(3), null);
});

test('replaces a corrected attempt instead of double-counting it', () => {
  const metrics = createReviewSessionMetrics({ originalWordIds: [11] });

  metrics.recordRating({ attemptId: 'same-attempt', wordId: 11, quality: 5 });
  metrics.recordRating({ attemptId: 'same-attempt', wordId: 11, quality: 1 });

  assert.deepEqual(metrics.summary(), {
    total: 1,
    mastered: 0,
    masteryRate: 0,
    known: 0,
    uncertain: 0,
    unknown: 1,
    rated: 1
  });
});

test('restores the complete result semantics from a serializable snapshot', () => {
  const source = createReviewSessionMetrics({ originalWordIds: [4, 5] });
  source.recordRating({ attemptId: 'four', wordId: 4, quality: 1 });
  source.recordRating({ attemptId: 'five', wordId: 5, quality: 5 });

  const restored = createReviewSessionMetrics({ snapshot: JSON.parse(JSON.stringify(source.snapshot())) });

  assert.deepEqual(restored.summary(), source.summary());
  assert.deepEqual(restored.getWordResult(4), { weakestQuality: 1, lastQuality: 1, mastered: false });
});

test('replaying the same attempt payload does not change learned, weakest, or result count', () => {
  const metrics = createReviewSessionMetrics({ originalWordIds: [21] });

  assert.equal(metrics.recordRating({ attemptId: 'replay', wordId: 21, quality: 3 }), true);
  const firstSummary = metrics.summary();
  const firstResult = metrics.getWordResult(21);

  assert.equal(metrics.recordRating({ attemptId: 'replay', wordId: 21, quality: 3 }), true);
  assert.deepEqual(metrics.summary(), firstSummary);
  assert.deepEqual(metrics.getWordResult(21), firstResult);
});

test('fuzzy then forgotten then known ends learned but stays classified as forgotten', () => {
  const metrics = createReviewSessionMetrics({ originalWordIds: [31] });

  metrics.recordRating({ attemptId: 'a', wordId: 31, quality: 3 });
  metrics.recordRating({ attemptId: 'b', wordId: 31, quality: 1 });
  metrics.recordRating({ attemptId: 'c', wordId: 31, quality: 5 });

  const summary = metrics.summary();
  assert.equal(summary.total, 1);
  assert.equal(summary.mastered, 1);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.uncertain, 0);
  assert.deepEqual(metrics.getWordResult(31), { weakestQuality: 1, lastQuality: 5, mastered: true });
});

test('a snapshot restored after a fuzzy rating keeps the weakest rating once the word is known', () => {
  const source = createReviewSessionMetrics({ originalWordIds: [41] });
  source.recordRating({ attemptId: 'first', wordId: 41, quality: 3 });

  const restored = createReviewSessionMetrics({ snapshot: JSON.parse(JSON.stringify(source.snapshot())) });
  restored.recordRating({ attemptId: 'reinserted', wordId: 41, quality: 5 });

  const summary = restored.summary();
  assert.equal(summary.total, 1);
  assert.equal(summary.mastered, 1);
  assert.equal(summary.uncertain, 1);
  assert.deepEqual(restored.getWordResult(41), { weakestQuality: 3, lastQuality: 5, mastered: true });
});

test('ratings outside the original word set or with invalid quality never pollute the session', () => {
  const metrics = createReviewSessionMetrics({ originalWordIds: [51] });

  assert.equal(metrics.recordRating({ attemptId: 'foreign', wordId: 999, quality: 5 }), false);
  assert.equal(metrics.recordRating({ attemptId: 'bad-quality', wordId: 51, quality: 4 }), false);
  assert.equal(metrics.recordRating({ attemptId: '', wordId: 51, quality: 5 }), false);
  assert.equal(metrics.recordRating(null), false);

  const summary = metrics.summary();
  assert.equal(summary.rated, 0);
  assert.equal(summary.mastered, 0);
  assert.equal(metrics.getWordResult(999), null);
});

test('a 20-word session with 24 exposures keeps a unique 20-word weakest-rated result', () => {
  const originalIds = Array.from({ length: 20 }, (_, index) => index + 1);
  const metrics = createReviewSessionMetrics({ originalWordIds: originalIds });

  let exposure = 0;
  const rate = (wordId, quality) => {
    exposure += 1;
    assert.equal(metrics.recordRating({ attemptId: `attempt-${exposure}`, wordId, quality }), true);
  };
  for (let id = 1; id <= 16; id += 1) rate(id, 5);
  for (let id = 17; id <= 19; id += 1) {
    rate(id, 3);
    rate(id, 5);
  }
  rate(20, 1);
  rate(20, 5);
  assert.equal(exposure, 24);

  const summary = metrics.summary();
  assert.equal(summary.total, 20);
  assert.equal(summary.mastered, 20);
  assert.equal(summary.masteryRate, 100);
  assert.equal(summary.known, 16);
  assert.equal(summary.uncertain, 3);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.rated, 20);

  const results = originalIds.map(id => metrics.getWordResult(id));
  assert.equal(results.filter(Boolean).length, 20);
  assert.deepEqual(
    results.filter(result => result.weakestQuality !== 5),
    [
      { weakestQuality: 3, lastQuality: 5, mastered: true },
      { weakestQuality: 3, lastQuality: 5, mastered: true },
      { weakestQuality: 3, lastQuality: 5, mastered: true },
      { weakestQuality: 1, lastQuality: 5, mastered: true }
    ]
  );
});

test('preserves the weakest rating across separate sessions on the same day', () => {
  assert.equal(typeof reviewSessionMetricsModule.mergeTodayReviewedWord, 'function');
  const merged = reviewSessionMetricsModule.mergeTodayReviewedWord(
    { word: 'author', quality: 1, weakestQuality: 1, lastQuality: 1, mastered: false },
    { word: 'author', quality: 5, weakestQuality: 5, lastQuality: 5, mastered: true }
  );

  assert.equal(merged.weakestQuality, 1);
  assert.equal(merged.lastQuality, 5);
  assert.equal(merged.quality, 5);
  assert.equal(merged.mastered, true);
});

test('flashcard checkpoints metrics and records a rating before a reinserted card returns early', async () => {
  const source = await readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8');

  assert.match(source, /createReviewSessionMetrics/);
  assert.match(source, /reviewSessionMetrics:\s*this\.reviewMetrics\.snapshot\(\)/);
  assert.match(source, /已学会 \$\{metrics\.mastered\} \/ \$\{metrics\.total\}/);
  assert.match(source, /\.\.\.this\.reviewMetrics\.getWordResult\(word\.id\)/);
  assert.match(source, /w\.weakestQuality \?\? w\.quality/);
  const progressStart = source.indexOf('renderProgress(phase)');
  const progressSource = source.slice(progressStart, source.indexOf('renderRecall(container)', progressStart));
  assert.match(progressSource, /const metrics = this\.reviewMetrics\.summary\(\)/);
  assert.match(progressSource, /const total = isPractice[\s\S]*?: metrics\.total/);
  assert.match(progressSource, /const completed = isPractice[\s\S]*?: metrics\.mastered/);
  assert.doesNotMatch(progressSource, /: this\.currentIndex/);
  const recordRatingStart = source.indexOf('async recordRating');
  assert.ok(
    source.indexOf('this.recordAcceptedRating(word, quality, attempt);', recordRatingStart) < source.indexOf('if (outcome.reinserted)', recordRatingStart),
    'metrics must be updated before the reinserted-card early return'
  );
});
