import assert from 'node:assert/strict';
import test from 'node:test';

import {
  articleGenreForArticle,
  articleTaxonomyLabels,
  examTypeForArticle,
  examTopicForArticle,
  formatPastExamLabel,
  matchesArticleTaxonomy,
  mergeCloudArticleDetail,
  matchesShelfDifficulty,
  normalizeCloudArticleMetadata,
  sourceLabelForArticle
} from '../src/cloud-article-metadata.mjs';

test('normalizes the controlled bookshelf topic and genre taxonomy with conservative legacy fallback', () => {
  assert.equal(examTopicForArticle({ examTopic: 'technology_environment' }), 'technology_environment');
  assert.equal(articleGenreForArticle({ articleGenre: 'research' }), 'research');
  assert.equal(examTopicForArticle({ examTopic: 'invented', category: 'science' }), 'technology_environment');
  assert.equal(examTopicForArticle({ category: 'world' }), 'public_affairs');
  assert.equal(examTopicForArticle({ category: 'unknown' }), '');
  assert.equal(articleGenreForArticle({ articleGenre: 'invented' }), '');
  assert.deepEqual(articleTaxonomyLabels({
    examTopic: 'health_psychology',
    articleGenre: 'explanation'
  }), {
    topic: '健康与心理',
    genre: '说明分析'
  });
});

test('bookshelf taxonomy filters combine topic and genre with AND semantics', () => {
  const article = {
    examTopic: 'technology_environment',
    articleGenre: 'research'
  };

  assert.equal(matchesArticleTaxonomy(article, { topic: 'all', genre: 'all' }), true);
  assert.equal(matchesArticleTaxonomy(article, { topic: 'technology_environment', genre: 'all' }), true);
  assert.equal(matchesArticleTaxonomy(article, { topic: 'technology_environment', genre: 'research' }), true);
  assert.equal(matchesArticleTaxonomy(article, { topic: 'public_affairs', genre: 'research' }), false);
  assert.equal(matchesArticleTaxonomy(article, { topic: 'technology_environment', genre: 'news' }), false);
});

test('normalizes cloud exam and past-exam metadata without inventing missing provenance', () => {
  assert.deepEqual(normalizeCloudArticleMetadata({
    source: 'past-exam',
    sourceType: null,
    examType: '英语一',
    examTypeConfidence: 0.95,
    examYear: 2024,
    examName: '英语一',
    examText: 'Text 3'
  }), {
    sourceType: 'past-exam',
    examType: '英语一',
    examTypeConfidence: 0.95,
    examYear: 2024,
    examName: '英语一',
    examText: 'Text 3',
    examTopic: null,
    articleGenre: null,
    topicConfidence: null,
    genreConfidence: null,
    classificationConfidence: null,
    classificationVersion: null,
    classificationSource: null,
    classifiedAt: null
  });

  assert.equal(formatPastExamLabel({ source: 'past-exam' }), '考研真题原文');
  assert.equal(normalizeCloudArticleMetadata({ examTypeConfidence: null }).examTypeConfidence, null);
  assert.equal(formatPastExamLabel({
    sourceType: 'past-exam', examYear: 2019, examName: '英语一', examText: 'Text 1'
  }), '2019 英语一 Text 1');
  assert.equal(formatPastExamLabel({ source: 'guardian_science' }), '');
});

test('maps examType and historical graduate material into the current shelf filters', () => {
  const englishOne = { difficulty: 'cet6', examType: '英语一' };
  const englishTwo = { difficulty: 'graduate', examType: '英语二' };
  const general = { difficulty: 'graduate', examType: '通用' };
  const legacy = { difficulty: 'graduate', examType: null };
  const trackedEnglishOne = { difficulty: 'cet6', targetTrack: 'kaoyan1' };

  assert.equal(examTypeForArticle(englishOne), '英语一');
  assert.equal(matchesShelfDifficulty(englishOne, 'kaoyan1'), true);
  assert.equal(matchesShelfDifficulty(englishOne, 'cet6'), false);
  assert.equal(matchesShelfDifficulty(englishTwo, 'kaoyan2'), true);
  assert.equal(matchesShelfDifficulty(general, 'kaoyan-general'), true);
  assert.equal(matchesShelfDifficulty(legacy, 'kaoyan-general'), true);
  assert.equal(matchesShelfDifficulty(legacy, 'graduate'), false);
  assert.equal(matchesShelfDifficulty(general, 'graduate'), false);
  assert.equal(matchesShelfDifficulty(trackedEnglishOne, 'kaoyan1'), true);
  assert.equal(matchesShelfDifficulty(trackedEnglishOne, 'cet6'), false);
});

test('localizes known cloud source names while preserving an unknown readable source', () => {
  assert.equal(sourceLabelForArticle({ source: 'scientific_american' }), '科学美国人');
  assert.equal(sourceLabelForArticle({ source: 'past-exam' }), '考研真题');
  assert.equal(sourceLabelForArticle({ source: 'custom_source' }), 'custom_source');
});

test('merges a detail response without losing provenance supplied by the shelf summary', () => {
  const merged = mergeCloudArticleDetail({
    id: 'cloud-7',
    source: 'past-exam',
    sourceType: 'past-exam',
    titleZh: '列表中文标题',
    examType: '英语一',
    examTypeConfidence: 0.93,
    examYear: 2020,
    examName: '英语一',
    examText: 'Text 4',
    examTopic: 'society_education',
    articleGenre: 'argument',
    topicConfidence: 0.92,
    genreConfidence: 0.9,
    classificationVersion: 'bookshelf-taxonomy-v1',
    classificationSource: 'ai',
    classifiedAt: '2026-07-29T12:00:00.000Z'
  }, {
    id: 'cloud-7',
    title: 'Full article',
    titleZh: '',
    content: 'Full content',
    category: 'science',
    sourceType: null,
    examType: null,
    examYear: null
  });

  assert.equal(merged.content, 'Full content');
  assert.equal(merged.titleZh, '列表中文标题');
  assert.equal(merged.sourceType, 'past-exam');
  assert.equal(merged.examType, '英语一');
  assert.equal(merged.examTypeConfidence, 0.93);
  assert.equal(merged.examYear, 2020);
  assert.equal(merged.examName, '英语一');
  assert.equal(merged.examText, 'Text 4');
  assert.equal(merged.examTopic, 'society_education');
  assert.equal(merged.articleGenre, 'argument');
  assert.equal(merged.topicConfidence, 0.92);
  assert.equal(merged.genreConfidence, 0.9);
  assert.equal(merged.classificationVersion, 'bookshelf-taxonomy-v1');
  assert.equal(merged.classificationSource, 'ai');
});
