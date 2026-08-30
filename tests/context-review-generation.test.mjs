import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveContextDifficultyProfile } from '../src/difficulty-profile.mjs';
import {
  createContextReviewGenerator,
  makeContextReviewCacheKey
} from '../src/components/context-review-runtime.mjs';

test('generates a profile-bound batch in one request', async () => {
  const requests = [];
  const generateBatch = createContextReviewGenerator({
    hasApiKey: () => true,
    fetch: async request => {
      requests.push(request);
      return {
        choices: [{ message: { content: JSON.stringify({
          items: [{
            wordId: 7,
            lemma: 'retain',
            targetForm: 'retain',
            sentence: 'Students retain essential academic vocabulary by following carefully planned review routines after every challenging weekly seminar session.',
            translationZh: '学生通过每周研讨课后遵循精心设计的复习流程来记住重要学术词汇。',
            senseIndex: 0
          }]
        }) } }]
      };
    },
    getTranslation: () => '保留'
  });
  const profile = resolveContextDifficultyProfile('stretch');

  const items = await generateBatch([
    { id: 7, word: 'retain', definitionSenses: [{ pos: 'verb', glossZh: '保留' }] }
  ], { sourceTrack: 'kaoyan1', difficultyProfile: profile });

  assert.equal(requests.length, 1);
  assert.match(requests[0].messages[0].content, /14-22 词/);
  assert.match(requests[0].messages[0].content, /目标词不计入/);
  assert.doesNotMatch(requests[0].messages[0].content, /目标考试/);
  assert.deepEqual(items.map(item => ({ key: item.difficultyProfileKey, status: item.difficultyStatus })), [
    { key: 'context-v2:stretch:c94', status: 'profiled' }
  ]);
});

test('isolates cache keys by source track and global profile', () => {
  const common = {
    wordId: 7,
    sentence: 'Students retain important vocabulary through guided review after every class.',
    source: 'ai',
    sourceTrack: 'cet6',
    difficultyStatus: 'profiled'
  };

  const standard = makeContextReviewCacheKey({ ...common, difficultyProfileKey: 'context-v2:standard:c96' });
  const stretch = makeContextReviewCacheKey({ ...common, difficultyProfileKey: 'context-v2:stretch:c94' });
  const otherTrack = makeContextReviewCacheKey({ ...common, sourceTrack: 'kaoyan1', difficultyProfileKey: 'context-v2:standard:c96' });
  const authenticSupport = makeContextReviewCacheKey({ ...common, source: 'exam-passage', difficultyStatus: 'authentic', difficultyProfileKey: 'context-v2:support:c98' });
  const authenticStretch = makeContextReviewCacheKey({ ...common, source: 'exam-passage', difficultyStatus: 'authentic', difficultyProfileKey: 'context-v2:stretch:c94' });
  const authenticOtherTrack = makeContextReviewCacheKey({ ...common, sourceTrack: 'kaoyan1', source: 'exam-passage', difficultyStatus: 'authentic' });

  assert.match(standard, /^context-v3:/);
  assert.notEqual(standard, stretch);
  assert.notEqual(standard, otherTrack);
  assert.equal(authenticSupport, authenticStretch);
  assert.notEqual(authenticSupport, authenticOtherTrack);
});
