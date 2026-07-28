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
  }
];

export class LearningAgent {
  constructor({ db, srs, now = () => Date.now() }) {
    this.db = db;
    this.srs = srs;
    this.now = now;
  }

  async execute(name, args = {}) {
    if (name === 'get_learning_overview') return this.getLearningOverview();
    if (name === 'find_learning_words') return this.findLearningWords(args.query);
    if (name === 'list_saved_articles') return this.listSavedArticles(args);
    if (name === 'get_review_queue') return this.getReviewQueue();
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
}
