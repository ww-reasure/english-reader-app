import { buildReadingAnalytics } from '../reading-analytics.mjs';

const clip = (value, limit) => String(value || '').slice(0, limit);

const articleMeta = article => ({
  id: article.id,
  title: clip(article.title, 120),
  difficulty: article.difficulty,
  topic: clip(article.topic, 48),
  createdAt: article.createdAt,
  favorite: Boolean(article.favorite),
  wordCount: article.wordCount || 0
});

export const LEARNING_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_learning_overview',
      description: '读取学习概览',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_learning_words',
      description: '查询词库和复习状态',
      parameters: { type: 'object', properties: { query: { type: 'string' } } }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_saved_articles',
      description: '查询收藏或保存文章的元数据',
      parameters: { type: 'object', properties: { favoriteOnly: { type: 'boolean' }, topic: { type: 'string' } } }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_review_queue',
      description: '读取待复习词',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_exam_learning_priorities',
      description: '读取当前目标考试中真题高频但尚未稳定掌握的词、到期重点词和可用真题例句数量，用于制定学习计划。',
      parameters: { type: 'object', properties: {} }
    }
  }
];

export class LearningAgent {
  constructor({ db, srs, examCorpus = null, targetTrack = () => '', now = () => Date.now() }) {
    this.db = db;
    this.srs = srs;
    this.examCorpus = examCorpus;
    this.targetTrack = targetTrack;
    this.now = now;
  }

  async execute(name, args = {}) {
    if (name === 'get_learning_overview') return this.getLearningOverview();
    if (name === 'find_learning_words') return this.findLearningWords(args.query);
    if (name === 'list_saved_articles') return this.listSavedArticles(args);
    if (name === 'get_review_queue') return this.getReviewQueue();
    if (name === 'get_exam_learning_priorities') return this.getExamLearningPriorities();
    throw new Error('Tool not allowed: ' + name);
  }

  async getLearningOverview() {
    const [words, articles, stats] = await Promise.all([
      this.db.getAllLearnWords(),
      this.db.getAllArticles(),
      this.db.getAllReadingStats()
    ]);
    const reading = buildReadingAnalytics({ articles, readingStats: stats, now: this.now() });
    return {
      source: 'learning_overview',
      totals: {
        words: words.length,
        due: this.srs.getDueCount(words),
        favorites: articles.filter(article => article.favorite).length,
        libraryArticles: reading.libraryArticleCount,
        effectiveReadings: reading.effectiveReadingCount,
        recent30EffectiveReadings: reading.recent30EffectiveReadingCount,
        distinctReadArticles: reading.distinctReadArticleCount,
        effectiveReadingSeconds: reading.totalSeconds
      }
    };
  }

  async findLearningWords(query = '') {
    const needle = String(query).trim().toLowerCase();
    const words = (await this.db.getAllLearnWords())
      .filter(word => !needle || String(word.word || '').toLowerCase().includes(needle) || String(word.translation || '').includes(needle))
      .slice(0, 20)
      .map(word => ({
        word: word.word,
        translation: clip(word.translation, 80),
        status: this.srs.getStatus(word),
        nextReview: word.nextReview || null
      }));
    return { source: 'learning_words', words };
  }

  async listSavedArticles({ favoriteOnly = false, topic = '' }) {
    const needle = String(topic).trim().toLowerCase();
    const articles = (await this.db.getAllArticles())
      .filter(article => (!favoriteOnly || article.favorite) && (!needle || String(article.topic || '').toLowerCase().includes(needle) || String(article.title || '').toLowerCase().includes(needle)))
      .slice(0, 10)
      .map(articleMeta);
    return { source: 'saved_articles', articles };
  }

  async getReviewQueue() {
    const words = this.srs.getDueWords(await this.db.getAllLearnWords())
      .slice(0, 20)
      .map(word => ({
        word: word.word,
        translation: clip(word.translation, 80),
        status: this.srs.getStatus(word),
        nextReview: word.nextReview || null
      }));
    return { source: 'review_queue', words };
  }

  async getExamLearningPriorities() {
    const targetTrack = String(this.targetTrack?.() || '').trim();
    if (!targetTrack || !this.examCorpus?.lookup) {
      return { source: 'exam_learning_priorities', targetTrack, status: 'unavailable', highFrequencyUnmastered: [], duePriorityWords: [] };
    }
    const words = await this.db.getAllLearnWords();
    const dueIds = new Set(this.srs.getDueWords(words).map(word => word.id));
    const rows = (await Promise.all(words.map(async word => {
      if (this.srs.getStatus(word) === 'stable') return null;
      const record = await this.examCorpus.lookup(word.word, targetTrack).catch(() => null);
      if (!record || record.priorityTier === 'uncovered' || Number(record.priorityScore) <= 0) return null;
      const examples = this.examCorpus.getExamples
        ? await this.examCorpus.getExamples(word.word, targetTrack).catch(() => [])
        : [];
      return {
        word: word.word,
        translation: clip(word.translation, 60),
        status: this.srs.getStatus(word),
        due: dueIds.has(word.id),
        priorityScore: Number(record.priorityScore) || 0,
        priorityLabel: clip(record.priorityLabel, 24),
        exampleCount: Array.isArray(examples) ? examples.length : 0
      };
    }))).filter(Boolean)
      .sort((left, right) => right.priorityScore - left.priorityScore || Number(right.due) - Number(left.due))
      .slice(0, 20);
    return {
      source: 'exam_learning_priorities',
      targetTrack,
      status: 'available',
      highFrequencyUnmastered: rows,
      duePriorityWords: rows.filter(item => item.due)
    };
  }
}
