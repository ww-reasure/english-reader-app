import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contentFingerprint,
  createReadingProgressSession,
  formatReadingDuration,
  normalizeReadingProgress,
  shouldPromoteReading
} from '../src/reading-progress.mjs';

const fingerprint = contentFingerprint('First paragraph.\n\nSecond paragraph.');

test('normalizes reading progress and keeps only valid, unique guide sentence indexes', () => {
  const progress = normalizeReadingProgress({
    articleId: 12,
    version: 1,
    contentFingerprint: fingerprint,
    status: 'in_progress',
    startedAt: 100,
    activeSeconds: 900,
    lastMode: 'guide',
    full: { maxProgress: 0.43, paragraphIndex: 2, sentenceIndex: 1 },
    guide: { lastIndex: 16, visitedIndexes: [-1, 0, 16, 16, 71, 999], totalSentences: 71 }
  }, { articleId: 12, contentFingerprint: fingerprint, totalSentences: 71 });

  assert.deepEqual(progress.guide.visitedIndexes, [0, 16]);
  assert.equal(progress.full.maxProgress, 0.43);
  assert.equal(progress.activeSeconds, 900);
  assert.equal(progress.lastMode, 'guide');
});

test('content fingerprint is stable for the reading body and incompatible content cannot resume', () => {
  assert.equal(contentFingerprint('One\n\nTwo'), contentFingerprint('One\r\n\r\nTwo'));
  assert.notEqual(contentFingerprint('One\n\nTwo'), contentFingerprint('One\n\nChanged'));
  const progress = normalizeReadingProgress({
    articleId: 1,
    contentFingerprint: contentFingerprint('old'),
    activeSeconds: 300
  }, { articleId: 1, contentFingerprint: contentFingerprint('new'), totalSentences: 1 });
  assert.equal(progress, null);
});

test('a completion-pending snapshot is never normalized into a resumable progress card', () => {
  const progress = normalizeReadingProgress({
    articleId: 9,
    contentFingerprint: fingerprint,
    status: 'completed_pending_cleanup',
    activeSeconds: 900
  }, { articleId: 9, contentFingerprint: fingerprint, totalSentences: 1 });
  assert.equal(progress, null);
});

test('preview promotion ignores initial viewport depth until a real signal occurs', () => {
  assert.equal(shouldPromoteReading({ activeSeconds: 5, actualScrollProgress: 1, didUserScroll: false }), false);
  assert.equal(shouldPromoteReading({ activeSeconds: 30, actualScrollProgress: 0, didUserScroll: false }), true);
  assert.equal(shouldPromoteReading({ activeSeconds: 1, actualScrollProgress: 0.1, didUserScroll: true }), true);
  assert.equal(shouldPromoteReading({ sessionGuideVisitedCount: 2 }), true);
  assert.equal(shouldPromoteReading({ bodyLookupCount: 1 }), true);
});

test('a persisted guide history does not satisfy the new-session two-sentence promotion gate', () => {
  const session = createReadingProgressSession({
    articleId: 2,
    content: 'One. Two. Three.',
    persisted: {
      articleId: 2,
      contentFingerprint: contentFingerprint('One. Two. Three.'),
      activeSeconds: 100,
      guide: { visitedIndexes: [0, 1, 2], lastIndex: 2, totalSentences: 3 }
    },
    now: () => 1000
  });

  session.recordActivity({ activeSeconds: 1, guideIndex: 2, mode: 'guide' });
  assert.equal(session.getState().phase, 'resume');
  session.recordActivity({ activeSeconds: 2, guideIndex: 1, mode: 'guide' });
  assert.equal(session.getState().phase, 'active');
});

test('promotion includes preview time and cumulative checkpoints use one fixed session base', async () => {
  const writes = [];
  const session = createReadingProgressSession({
    articleId: 3,
    content: 'A readable article.',
    persisted: { articleId: 3, contentFingerprint: contentFingerprint('A readable article.'), activeSeconds: 900 },
    now: () => 2000,
    save: async progress => { writes.push(progress); }
  });

  session.recordActivity({ activeSeconds: 120, actualScrollProgress: 0.2, didUserScroll: true, fullProgress: 0.43 });
  assert.equal(session.getState().phase, 'active');
  await session.checkpoint({ activeSeconds: 120, fullProgress: 0.43, fullAnchor: { paragraphIndex: 2, sentenceIndex: 1 } });
  await session.checkpoint({ activeSeconds: 120, fullProgress: 0.08, fullAnchor: { paragraphIndex: 0, sentenceIndex: 0 } });

  assert.equal(writes.at(-1).activeSeconds, 1020);
  assert.equal(writes.at(-1).full.maxProgress, 0.43);
  assert.deepEqual(writes.at(-1).full, { maxProgress: 0.43, paragraphIndex: 2, sentenceIndex: 1 });
});

test('guide progress is a persisted union and only session visits drive promotion', async () => {
  const writes = [];
  const session = createReadingProgressSession({
    articleId: 4,
    content: 'One. Two. Three.',
    persisted: { articleId: 4, contentFingerprint: contentFingerprint('One. Two. Three.'), guide: { visitedIndexes: [0], lastIndex: 0, totalSentences: 3 } },
    now: () => 3000,
    save: async progress => { writes.push(progress); }
  });
  session.recordActivity({ activeSeconds: 1, guideIndex: 1, mode: 'guide' });
  session.recordActivity({ activeSeconds: 2, guideIndex: 2, mode: 'guide' });
  await session.checkpoint({ activeSeconds: 2, mode: 'guide', guideIndex: 2 });

  assert.equal(session.getState().phase, 'active');
  assert.deepEqual(writes.at(-1).guide.visitedIndexes, [0, 1, 2]);
  assert.equal(writes.at(-1).guide.lastIndex, 2);
});

test('explicit resume activates without manufacturing additional reading time', async () => {
  const writes = [];
  const session = createReadingProgressSession({
    articleId: 6,
    content: 'A saved article.',
    persisted: {
      articleId: 6,
      contentFingerprint: contentFingerprint('A saved article.'),
      activeSeconds: 480,
      full: { maxProgress: 0.38, paragraphIndex: 1, sentenceIndex: 0 }
    },
    now: () => 5000,
    save: async progress => writes.push(progress)
  });

  session.recordActivity({ activeSeconds: 8 });
  assert.equal(session.getState().phase, 'resume');
  session.activate('explicit_resume');
  await session.checkpoint({ activeSeconds: 8, fullProgress: 0.38 });

  assert.equal(writes.at(-1).activeSeconds, 488);
  assert.equal(writes.at(-1).full.maxProgress, 0.38);
});

test('latest checkpoint wins and completion prevents a late save from reviving deleted progress', async () => {
  let release;
  let saved = [];
  const removeCalls = [];
  const session = createReadingProgressSession({
    articleId: 5,
    content: 'A long article.',
    now: () => 4000,
    save: async progress => {
      await new Promise(resolve => { release = resolve; });
      saved.push(progress);
    },
    remove: async articleId => removeCalls.push(articleId)
  });
  session.activate('explicit_resume');
  const first = session.checkpoint({ activeSeconds: 39, fullProgress: 0.39 });
  const second = session.checkpoint({ activeSeconds: 45, fullProgress: 0.45 });
  const completion = session.complete({ activeSeconds: 45, fullProgress: 1 });
  release();
  await Promise.all([first, second, completion]);

  assert.equal(removeCalls.length, 1);
  assert.equal(removeCalls[0], 5);
  assert.equal(saved.at(-1).full.maxProgress, 1);
  assert.equal(session.getState().phase, 'completed');
  await session.checkpoint({ activeSeconds: 60, fullProgress: 1 });
  assert.equal(saved.at(-1).full.maxProgress, 1);
});

test('completion cleanup can be retried without repeating the final progress save', async () => {
  let removeAttempts = 0;
  let saveCalls = 0;
  let storedSnapshot = null;
  const session = createReadingProgressSession({
    articleId: 7,
    content: 'A completed article.',
    now: () => 7000,
    save: async snapshot => {
      saveCalls += 1;
      assert.equal(snapshot.status, 'completed_pending_cleanup');
      storedSnapshot = snapshot;
    },
    remove: async () => {
      removeAttempts += 1;
      if (removeAttempts === 1) throw new Error('delete temporarily unavailable');
      storedSnapshot = null;
    }
  });

  session.activate('explicit_resume');
  await assert.rejects(session.complete({ activeSeconds: 45, fullProgress: 1 }));
  assert.equal(session.getState().completion.cleanupPending, true);
  await session.complete();

  assert.equal(saveCalls, 1);
  assert.equal(removeAttempts, 2);
  assert.equal(session.getState().completion.cleanupPending, false);
  assert.equal(session.getState().completion.cleanupCompleted, true);
  assert.equal(storedSnapshot, null);
});

test('a failing old writer cannot replace the newer completion snapshot', async () => {
  let rejectFirst;
  let firstStarted;
  const saves = [];
  const session = createReadingProgressSession({
    articleId: 8,
    content: 'Another completed article.',
    now: () => 8000,
    save: async snapshot => {
      saves.push(snapshot);
      if (saves.length === 1) {
        await new Promise((resolve, reject) => { firstStarted = resolve; rejectFirst = reject; });
      }
    },
    remove: async () => {}
  });

  session.activate('explicit_resume');
  const oldCheckpoint = session.checkpoint({ activeSeconds: 39, fullProgress: 0.39 });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(rejectFirst);
  const completion = session.complete({ activeSeconds: 45, fullProgress: 1 });
  rejectFirst(new Error('old checkpoint failed'));
  await assert.rejects(oldCheckpoint);
  await completion;

  await session.complete();
  assert.equal(saves.at(-1).status, 'completed_pending_cleanup');
  assert.equal(saves.at(-1).full.maxProgress, 1);
  void firstStarted;
});

test('keeps one completion id for a persisted reading cycle', () => {
  const content = 'A stable reading cycle.';
  const completionId = 'reading:12:reading-v1-test:1000';
  const session = createReadingProgressSession({
    articleId: 12,
    content,
    persisted: {
      articleId: 12,
      contentFingerprint: contentFingerprint(content),
      completionId,
      startedAt: 1000,
      updatedAt: 1100,
      activeSeconds: 45
    },
    now: () => 2000
  });

  assert.equal(session.getCompletionId(), completionId);
  assert.equal(session.getSnapshot().completionId, completionId);
});

test('a generated completion id survives the first checkpoint and a simulated restart', async () => {
  let persistedSnapshot = null;
  const content = 'A checkpointed reading cycle.';
  const first = createReadingProgressSession({
    articleId: 14,
    content,
    now: () => 4000,
    save: async snapshot => { persistedSnapshot = snapshot; }
  });
  first.activate('explicit_resume');
  await first.checkpoint({ activeSeconds: 45, fullProgress: 0.5 });

  const reopened = createReadingProgressSession({
    articleId: 14,
    content,
    persisted: persistedSnapshot,
    now: () => 9000
  });

  assert.ok(persistedSnapshot.completionId);
  assert.equal(reopened.getCompletionId(), first.getCompletionId());
});

test('a new reading cycle gets a different completion id after progress is removed', () => {
  const first = createReadingProgressSession({
    articleId: 13,
    content: 'A rereadable article.',
    now: () => 3000
  });
  const second = createReadingProgressSession({
    articleId: 13,
    content: 'A rereadable article.',
    now: () => 3001
  });

  assert.notEqual(first.getCompletionId(), second.getCompletionId());
});

test('reading duration is compact and handles sub-minute sessions', () => {
  assert.equal(formatReadingDuration(0), '<1 分钟');
  assert.equal(formatReadingDuration(45), '<1 分钟');
  assert.equal(formatReadingDuration(24 * 60), '24 分钟');
  assert.equal(formatReadingDuration(65 * 60), '1 小时 5 分钟');
});
