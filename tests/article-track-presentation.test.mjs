import assert from 'node:assert/strict';
import test from 'node:test';

import * as metadata from '../src/cloud-article-metadata.mjs';

test('exports one shared article track resolver for every article surface', () => {
  assert.equal(typeof metadata.resolveArticleTrack, 'function');
});

test('exam type is the primary track while a different CET difficulty stays a vocabulary baseline', () => {
  assert.deepEqual(metadata.resolveArticleTrack({ difficulty: 'cet6', examType: '英语一' }), {
    targetTrack: 'kaoyan1',
    primaryLabel: '英语一',
    badgeClass: 'kaoyan1',
    baselineLabel: '词汇基线：六级',
    isLegacy: false
  });
});

test('current exam metadata never falls back to the legacy graduate label', () => {
  assert.deepEqual(metadata.resolveArticleTrack({ difficulty: 'graduate', examType: '英语二' }), {
    targetTrack: 'kaoyan2',
    primaryLabel: '英语二',
    badgeClass: 'kaoyan2',
    baselineLabel: '',
    isLegacy: false
  });
});

test('an unclassified historical graduate article is presented as general graduate reading', () => {
  assert.deepEqual(metadata.resolveArticleTrack({ difficulty: 'graduate' }), {
    targetTrack: 'kaoyan-general',
    primaryLabel: '考研通用',
    badgeClass: 'graduate',
    baselineLabel: '',
    isLegacy: false
  });
});

test('targetTrack is used before the raw difficulty when cloud exam metadata is absent', () => {
  assert.deepEqual(metadata.resolveArticleTrack({ difficulty: 'cet6', targetTrack: 'kaoyan1' }), {
    targetTrack: 'kaoyan1',
    primaryLabel: '英语一',
    badgeClass: 'kaoyan1',
    baselineLabel: '词汇基线：六级',
    isLegacy: false
  });
});
