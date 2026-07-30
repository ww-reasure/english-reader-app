const EXAM_TYPES = new Set(['英语一', '英语二', '通用']);
const EXAM_TOPICS = new Set([
  'society_education',
  'technology_environment',
  'economy_workplace',
  'health_psychology',
  'culture_history',
  'public_affairs'
]);
const ARTICLE_GENRES = new Set(['argument', 'explanation', 'research', 'news', 'narrative']);
const CLASSIFICATION_SOURCES = new Set(['ai', 'rule', 'manual']);

const EXAM_TOPIC_LABELS = Object.freeze({
  society_education: '社会与教育',
  technology_environment: '科技与环境',
  economy_workplace: '经济与职场',
  health_psychology: '健康与心理',
  culture_history: '文化与历史',
  public_affairs: '公共事务'
});

const ARTICLE_GENRE_LABELS = Object.freeze({
  argument: '观点论述',
  explanation: '说明分析',
  research: '研究解读',
  news: '新闻报道',
  narrative: '人物叙事'
});

const LEGACY_CATEGORY_TOPICS = Object.freeze({
  science: 'technology_environment',
  world: 'public_affairs',
  society: 'society_education',
  culture: 'culture_history'
});

const ARTICLE_TRACKS = new Set(['cet4', 'cet6', 'kaoyan1', 'kaoyan2', 'kaoyan-general', 'graduate']);
const TRACK_PRESENTATION = Object.freeze({
  cet4: { primaryLabel: '四级', badgeClass: 'cet4' },
  cet6: { primaryLabel: '六级', badgeClass: 'cet6' },
  kaoyan1: { primaryLabel: '英语一', badgeClass: 'kaoyan1' },
  kaoyan2: { primaryLabel: '英语二', badgeClass: 'kaoyan2' },
  'kaoyan-general': { primaryLabel: '考研通用', badgeClass: 'graduate' },
  graduate: { primaryLabel: '考研通用', badgeClass: 'graduate' }
});
const EXAM_TYPE_TRACKS = Object.freeze({
  英语一: 'kaoyan1',
  英语二: 'kaoyan2',
  通用: 'kaoyan-general'
});

const SOURCE_LABELS = Object.freeze({
  csmonitor: '基督教科学箴言报',
  scientific_american: '科学美国人',
  atlantic: '大西洋月刊',
  guardian_opinion: '卫报评论',
  the_conversation: '学术对话',
  new_scientist: '新科学家',
  smithsonian: '史密森学会',
  guardian_science: '卫报科学',
  guardian_environment: '卫报环境',
  mit_tech_review: '麻省理工科技评论',
  popular_science: '大众科学',
  sciencedaily: '每日科学',
  'past-exam': '考研真题'
});

const text = (value, limit = 80) => String(value || '').trim().slice(0, limit);

const confidenceValue = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
};

const explicitExamTopicForArticle = article => {
  const explicit = text(article?.examTopic, 40).toLocaleLowerCase('en-US');
  return EXAM_TOPICS.has(explicit) ? explicit : '';
};

export function examTopicForArticle(article = {}) {
  const explicit = explicitExamTopicForArticle(article);
  if (explicit) return explicit;
  return LEGACY_CATEGORY_TOPICS[text(article.category, 24).toLocaleLowerCase('en-US')] || '';
}

export function articleGenreForArticle(article = {}) {
  const genre = text(article.articleGenre, 32).toLocaleLowerCase('en-US');
  return ARTICLE_GENRES.has(genre) ? genre : '';
}

export function articleTaxonomyLabels(article = {}) {
  return {
    topic: EXAM_TOPIC_LABELS[examTopicForArticle(article)] || '',
    genre: ARTICLE_GENRE_LABELS[articleGenreForArticle(article)] || ''
  };
}

export function matchesArticleTaxonomy(article = {}, filters = {}) {
  const topic = text(filters.topic || 'all', 40).toLocaleLowerCase('en-US');
  const genre = text(filters.genre || 'all', 32).toLocaleLowerCase('en-US');
  const matchesTopic = !topic || topic === 'all' || examTopicForArticle(article) === topic;
  const matchesGenre = !genre || genre === 'all' || articleGenreForArticle(article) === genre;
  return matchesTopic && matchesGenre;
}

export function examTypeForArticle(article = {}) {
  const value = text(article.examType, 12);
  return EXAM_TYPES.has(value) ? value : '';
}

export function resolveArticleTrack(article = {}) {
  const difficulty = text(article.difficulty, 24).toLocaleLowerCase('en-US');
  const explicitTarget = text(article.targetTrack, 24).toLocaleLowerCase('en-US');
  const examTrack = EXAM_TYPE_TRACKS[examTypeForArticle(article)] || '';
  const resolvedTrack = examTrack
    || (ARTICLE_TRACKS.has(explicitTarget) ? explicitTarget : '')
    || (ARTICLE_TRACKS.has(difficulty) ? difficulty : '');
  const targetTrack = resolvedTrack === 'graduate' ? 'kaoyan-general' : resolvedTrack;
  const presentation = TRACK_PRESENTATION[targetTrack] || {
    primaryLabel: targetTrack || '未标注',
    badgeClass: 'unknown'
  };
  const baselineLabel = ['cet4', 'cet6'].includes(difficulty) && difficulty !== targetTrack
    ? `词汇基线：${TRACK_PRESENTATION[difficulty].primaryLabel}`
    : '';

  return {
    targetTrack: targetTrack || 'unknown',
    primaryLabel: presentation.primaryLabel,
    badgeClass: presentation.badgeClass,
    baselineLabel,
    isLegacy: false
  };
}

export function sourceTypeForArticle(article = {}) {
  const explicit = text(article.sourceType, 24).toLocaleLowerCase('en-US');
  if (explicit === 'past-exam' || text(article.source, 40).toLocaleLowerCase('en-US') === 'past-exam') return 'past-exam';
  return 'rss';
}

export function normalizeCloudArticleMetadata(article = {}) {
  const hasConfidence = article.examTypeConfidence !== null
    && article.examTypeConfidence !== undefined
    && article.examTypeConfidence !== '';
  const confidence = hasConfidence ? Number(article.examTypeConfidence) : Number.NaN;
  const year = Number(article.examYear);
  const examTopic = examTopicForArticle(article) || null;
  const articleGenre = articleGenreForArticle(article) || null;
  const topicConfidence = confidenceValue(article.topicConfidence);
  const genreConfidence = confidenceValue(article.genreConfidence);
  const suppliedClassificationConfidence = confidenceValue(article.classificationConfidence);
  const classificationConfidence = suppliedClassificationConfidence
    ?? (topicConfidence !== null && genreConfidence !== null ? Math.min(topicConfidence, genreConfidence) : null);
  const classificationSource = text(article.classificationSource, 16).toLocaleLowerCase('en-US');
  const classifiedAt = text(article.classifiedAt, 40);
  return {
    sourceType: sourceTypeForArticle(article),
    examType: examTypeForArticle(article) || null,
    examTypeConfidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null,
    examYear: Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
    examName: text(article.examName, 24) || null,
    examText: text(article.examText, 32) || null,
    examTopic,
    articleGenre,
    topicConfidence,
    genreConfidence,
    classificationConfidence,
    classificationVersion: text(article.classificationVersion, 48) || null,
    classificationSource: CLASSIFICATION_SOURCES.has(classificationSource) ? classificationSource : null,
    classifiedAt: classifiedAt && Number.isFinite(Date.parse(classifiedAt)) ? classifiedAt : null
  };
}

export function matchesShelfDifficulty(article = {}, filter = 'all') {
  if (!filter || filter === 'all') return true;
  return resolveArticleTrack(article).targetTrack === filter;
}

export function formatPastExamLabel(article = {}) {
  if (sourceTypeForArticle(article) !== 'past-exam') return '';
  const metadata = normalizeCloudArticleMetadata(article);
  const parts = [metadata.examYear, metadata.examName, metadata.examText].filter(Boolean);
  return parts.length === 3 ? parts.join(' ') : '考研真题原文';
}

export function sourceLabelForArticle(article = {}) {
  const source = text(article.source, 80);
  return SOURCE_LABELS[source] || source;
}

export function examBadgeForArticle(article = {}) {
  const examType = examTypeForArticle(article);
  if (examType === '英语一') return { label: '英语一', className: 'kaoyan1' };
  if (examType === '英语二') return { label: '英语二', className: 'kaoyan2' };
  if (examType === '通用') return { label: '考研通用', className: 'graduate' };
  return null;
}

export function mergeCloudArticleDetail(summary = {}, detail = {}) {
  const summaryMetadata = normalizeCloudArticleMetadata(summary);
  const detailMetadata = normalizeCloudArticleMetadata(detail);
  const merged = { ...summary, ...detail };
  const mergedExamTopic = explicitExamTopicForArticle(detail)
    || explicitExamTopicForArticle(summary)
    || detailMetadata.examTopic
    || summaryMetadata.examTopic;

  return {
    ...merged,
    titleZh: text(detail.titleZh, 240) || text(summary.titleZh, 240),
    source: text(detail.source, 80) || text(summary.source, 80),
    sourceType: detailMetadata.sourceType === 'past-exam' || summaryMetadata.sourceType === 'past-exam'
      ? 'past-exam'
      : 'rss',
    examType: detailMetadata.examType ?? summaryMetadata.examType,
    examTypeConfidence: detailMetadata.examTypeConfidence ?? summaryMetadata.examTypeConfidence,
    examYear: detailMetadata.examYear ?? summaryMetadata.examYear,
    examName: detailMetadata.examName ?? summaryMetadata.examName,
    examText: detailMetadata.examText ?? summaryMetadata.examText,
    examTopic: mergedExamTopic || null,
    articleGenre: detailMetadata.articleGenre ?? summaryMetadata.articleGenre,
    topicConfidence: detailMetadata.topicConfidence ?? summaryMetadata.topicConfidence,
    genreConfidence: detailMetadata.genreConfidence ?? summaryMetadata.genreConfidence,
    classificationConfidence: detailMetadata.classificationConfidence ?? summaryMetadata.classificationConfidence,
    classificationVersion: detailMetadata.classificationVersion ?? summaryMetadata.classificationVersion,
    classificationSource: detailMetadata.classificationSource ?? summaryMetadata.classificationSource,
    classifiedAt: detailMetadata.classifiedAt ?? summaryMetadata.classifiedAt
  };
}

export const CloudArticleMetadata = Object.freeze({
  examTopicForArticle,
  articleGenreForArticle,
  articleTaxonomyLabels,
  matchesArticleTaxonomy,
  examTypeForArticle,
  resolveArticleTrack,
  sourceTypeForArticle,
  normalizeCloudArticleMetadata,
  matchesShelfDifficulty,
  formatPastExamLabel,
  sourceLabelForArticle,
  examBadgeForArticle,
  mergeCloudArticleDetail
});
