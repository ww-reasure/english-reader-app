import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WORD_STUDY_TABS,
  mergeWordStudyExamples,
  renderWordStudyPanel,
  renderWordStudyTabs
} from '../src/components/word-study-materials.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('shared study materials combine roots with memory and reserve a tab for synonyms', () => {
  assert.deepEqual(WORD_STUDY_TABS.map(tab => tab.id), ['examples', 'roots', 'related', 'phrases', 'similar']);
  assert.deepEqual(WORD_STUDY_TABS.map(tab => tab.label), ['例句', '词根记忆', '同根词', '词组', '近义词']);
  assert.match(renderWordStudyTabs('phrases'), /data-study-tab="phrases"[^>]*aria-selected="true"/);

  const html = renderWordStudyPanel({
    activeTab: 'phrases',
    phrases: {
      status: 'ready',
      items: [{ phrase: 'graduate <from>', glossZh: '毕业于' }]
    }
  });
  assert.match(html, /graduate &lt;from&gt;/);
  assert.match(html, /毕业于/);
  assert.doesNotMatch(html, /graduate <from>/);
});

test('root tab keeps its memory aid while synonym panel loads independently', () => {
  const rootHtml = renderWordStudyPanel({
    activeTab: 'roots',
    rootAnalysis: { breakdown: 'grad-（步） + -uate（动词后缀）', memoryTip: '联想 grade（等级）：毕业是完成一个学习等级。' }
  });
  assert.match(rootHtml, /词根拆解/);
  assert.match(rootHtml, /记忆法/);
  assert.match(rootHtml, /grade（等级）/);

  assert.match(renderWordStudyPanel({ activeTab: 'similar', similar: { status: 'loading', items: [] } }), /正在整理近义词/);
  assert.match(renderWordStudyPanel({ activeTab: 'similar', similar: { status: 'error', items: [] } }), /data-retry-similar/);
  assert.match(renderWordStudyPanel({ activeTab: 'similar', similar: { status: 'ready', items: [] } }), /暂无可用近义词/);
});

test('combined root-memory and synonym rows preserve the dossier reading hierarchy', async () => {
  const css = await read('../css/style.css');
  assert.match(css, /\.word-study-section-label\s*\{/);
  assert.match(css, /\.word-study-memory-section\s*\{/);
  assert.match(css, /\.word-study-similar-copy\s*\{/);
  assert.match(css, /\.word-study-similar-nuance\s*\{/);
});

test('phrase panel has loading, retryable failure, and empty states', () => {
  assert.match(renderWordStudyPanel({ activeTab: 'phrases', phrases: { status: 'loading', items: [] } }), /正在整理常用词组/);
  assert.match(renderWordStudyPanel({ activeTab: 'phrases', phrases: { status: 'error', items: [] } }), /data-retry-phrases/);
  assert.match(renderWordStudyPanel({ activeTab: 'phrases', phrases: { status: 'ready', items: [] } }), /暂无可用词组/);
});

test('true exam examples lead the example panel with an honest source and cached translation', () => {
  const examples = mergeWordStudyExamples([
    {
      id: 'exam-1',
      sentenceEn: 'The author explains why the policy changed.',
      translationZh: '作者解释了政策为何发生变化。',
      sourceKind: 'passage',
      paperLabel: '考研英语一 2024',
      positionLabel: '文章原文 · 第2段'
    }
  ], [
    'The author wrote a short note.',
    'The author explains why the policy changed.'
  ]);

  assert.equal(examples.length, 2);
  assert.equal(examples[0].isExam, true);
  assert.equal(examples[1].isExam, false);

  const html = renderWordStudyPanel({ activeTab: 'examples', examples });
  assert.match(html, /真题正文/);
  assert.match(html, /考研英语一 2024/);
  assert.match(html, /文章原文 · 第2段/);
  assert.match(html, /data-cached-translation="作者解释了政策为何发生变化。"/);
  assert.match(html, /The author wrote a short note\./);
});

test('all full word details share the focused study sheet while tooltip stays compact with a detail entry', async () => {
  const [detail, vocabulary, learnWords, flashcard, tooltip, css] = await Promise.all([
    read('../src/components/word-study-detail.js'),
    read('../src/views/vocabulary.js'),
    read('../src/views/learn-words.js'),
    read('../src/views/flashcard.js'),
    read('../src/components/tooltip.js'),
    read('../css/style.css')
  ]);

  assert.match(detail, /word-study-detail-sheet/);
  assert.match(detail, /WordStudyDetail/);
  assert.match(vocabulary, /WordStudyDetail\.open/);
  assert.match(learnWords, /WordStudyDetail\.open/);
  assert.match(flashcard, /WORD_STUDY_TABS/);
  assert.match(flashcard, /phrases/);
  assert.match(flashcard, /ExamCorpus\.getExamples/);
  assert.match(flashcard, /mergeWordStudyExamples/);
  assert.match(tooltip, /查看学习详情/);
  assert.match(tooltip, /WordStudyDetail\.open/);
  assert.match(tooltip, /targetTrack/);
  assert.match(detail, /ExamCorpus\.getExamples/);
  assert.match(detail, /mergeWordStudyExamples/);
  assert.match(detail, /renderExamCorpusDetail/);
  assert.match(detail, /flashcard-study-masthead/);
  assert.match(detail, /flashcard-study-tabs/);
  assert.match(detail, /flashcard-study-info-overlay/);
  assert.match(css, /\.word-study-detail-sheet\s*\{[^}]*grid-template-rows:auto auto minmax\(0,1fr\)/s);
  assert.match(css, /\.flashcard-study-tabs\s*\{[^}]*overflow-x:auto/s);
});

test('full details and review reuse the same focused study-stage hierarchy', async () => {
  const [detail, flashcard, css] = await Promise.all([
    read('../src/components/word-study-detail.js'),
    read('../src/views/flashcard.js'),
    read('../css/style.css')
  ]);

  assert.match(detail, /word-study-detail-masthead/);
  assert.match(detail, /flashcard-study-info-overlay/);
  assert.match(detail, /renderFocusedWordStudyExample/);
  assert.match(flashcard, /flashcard-study-masthead/);
  assert.match(flashcard, /flashcard-study-info-trigger/);
  assert.match(flashcard, /renderFocusedWordStudyExample/);
  assert.match(css, /\.word-study-detail-masthead\s*\{/);
  assert.match(css, /\.word-study-detail-sheet\s*\{[^}]*height:100dvh/s);
  assert.match(css, /\.word-study-detail-panel\s*\{[^}]*padding-top:16px/s);
  assert.match(css, /\.flashcard-study-masthead\s*\{[^}]*background:transparent/s);
  assert.match(css, /\.flashcard-study-panel \.flashcard-focused-example\s*\{[^}]*min-height:100%/s);
});

test('a full detail opened from an AI analysis is promoted above its pre-existing modal layer', async () => {
  const [detail, css] = await Promise.all([
    read('../src/components/word-study-detail.js'),
    read('../css/style.css')
  ]);

  // The study overlay may have been created on an earlier page. Opening it
  // from a later AI modal must move it to the top of the document stack.
  assert.match(detail, /const overlay = this\.ensureOverlay\(\);\s*document\.body\.appendChild\(overlay\);/s);
  assert.match(css, /\.word-study-detail-overlay\s*\{[^}]*z-index:1300/s);
});

test('all full detail surfaces use the same focused study-stage renderer', async () => {
  const [detail, flashcard] = await Promise.all([
    read('../src/components/word-study-detail.js'),
    read('../src/views/flashcard.js')
  ]);

  assert.match(detail, /from '\.\/word-study-stage\.mjs'/);
  assert.match(flashcard, /from '\.\.\/components\/word-study-stage\.mjs'/);
  assert.match(detail, /renderFocusedWordStudyExample/);
  assert.match(flashcard, /renderFocusedWordStudyExample/);
  assert.match(detail, /flashcard-study-tabs/);
});

test('focused example stage exposes a guarded horizontal swipe transition', async () => {
  const stage = await read('../src/components/word-study-stage.mjs');
  assert.match(stage, /export function getHorizontalSwipeDirection/);
  assert.match(stage, /Math\.abs\(deltaX\)/);
  assert.match(stage, /Math\.abs\(deltaY\)/);
  assert.match(stage, /44/);
});

test('full word details keep stable gesture and information-panel contracts', async () => {
  const [detail, stage] = await Promise.all([
    read('../src/components/word-study-detail.js'),
    read('../src/components/word-study-stage.mjs')
  ]);
  assert.match(detail, /getHorizontalSwipeDirection/);
  assert.match(detail, /data-study-info-overlay/);
  assert.match(detail, /word-study-info-empty/);
  assert.match(stage, /export function getHorizontalSwipeDirection/);
});
