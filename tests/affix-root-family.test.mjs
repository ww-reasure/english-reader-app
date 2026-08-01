import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  normalizeRootFamily,
  normalizeRelatedRootWord,
  renderRootHighlightedWord
} from '../src/components/affix-root-family.mjs';
import { renderWordStudyPanel } from '../src/components/word-study-materials.mjs';

test('keeps only exact, validated root forms for a related word highlight', () => {
  const family = normalizeRootFamily({
    label: 'duc / duct',
    meaningZh: '引导；带领',
    forms: ['duc', 'duct', 'duc']
  });
  const related = normalizeRelatedRootWord({
    word: 'production',
    translation: '生产；制造',
    rootForm: 'duct'
  }, family);

  assert.deepEqual(family, {
    label: 'duc / duct',
    meaningZh: '引导；带领',
    forms: ['duc', 'duct']
  });
  assert.equal(related.rootForm, 'duct');
  assert.match(renderRootHighlightedWord(related.word, related.rootForm), /word-study-root-highlight/);
  assert.doesNotMatch(renderRootHighlightedWord('production', 'duce'), /word-study-root-highlight/);
});

test('root analysis upgrades expose a versioned cache and an on-demand structured enrichment path', async () => {
  const [source, detail, flashcard] = await Promise.all([
    readFile(new URL('../src/affixes.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/word-study-detail.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8')
  ]);

  assert.match(source, /root_v3_/);
  assert.match(source, /ensureStructuredRoot\(/);
  assert.match(source, /rootFamily/);
  assert.match(source, /rootForm/);
  assert.match(detail, /loadStructuredRoot/);
  assert.match(flashcard, /loadStructuredRoot/);
  assert.match(flashcard, /cancelRootRequest/);
});

test('related words name their common root and highlight only its verified spelling', () => {
  const html = renderWordStudyPanel({
    activeTab: 'related',
    rootAnalysis: {
      rootFamily: { label: 'duc / duct', meaningZh: '引导；带领', forms: ['duc', 'duct'] },
      relatedWords: ['production'],
      relatedTranslations: { production: '生产；制造' },
      relatedRootForms: { production: 'duct' }
    }
  });

  assert.match(html, /共同词根/);
  assert.match(html, /duc \/ duct/);
  assert.match(html, /引导；带领/);
  assert.match(html, /pro<mark class="word-study-root-highlight">duct<\/mark>ion/);
});
