import { buildReadingAnalytics } from '../reading-analytics.mjs';
import { localDayKey } from '../learning-day.mjs';

const clip = (value, limit) => String(value || '').slice(0, limit);
const activeLearnWords = words => (Array.isArray(words) ? words : []).filter(word => word?.archivedAt == null);

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
      name: 'get_exam_learning_overview',
      description: '只读查询真题练习表现、趋势和复习摘要。仅当用户明确提到某一年时传入 year；仅在明确提到四级或英语一时传入 bankId。',
      parameters: { type: 'object', properties: { year: { type: 'integer', minimum: 2000, maximum: 2100 }, bankId: { type: 'string' } } }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_today_learning_report',
      description: '只读查询今天本地日期的学习日报。日期由 App 自动确定，不需要也不接受日期参数；只返回本地有界学习事实。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_daily_learning_report',
      description: '只读查询指定本地日期的学习日报。数据来自本机学习记录，可能标记为部分可用或不可用；若该日期已有保存的智能分析会一并返回，但不会因缺少分析主动发起 AI 请求；不包含完整文章、试卷或对话内容。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '本地日期 YYYY-MM-DD' }
        },
        required: ['date'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_recent_learning_reports',
      description: '只读列出最近的本地学习日报摘要。结果最多 30 条，历史数据可能部分可用或已过期。',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 30 } },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_learning_activity_detail',
      description: '只读查看指定本地日期和类别的有界学习活动明细。仅返回元数据，可能部分可用；不返回完整文章、题目、答案或对话。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          category: { type: 'string', enum: ['vocabulary', 'lookup', 'reading', 'review', 'exam'] },
          limit: { type: 'integer', minimum: 1, maximum: 100 }
        },
        required: ['date', 'category'],
        additionalProperties: false
      }
    }
  },
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

const DAILY_REPORT_CATEGORIES = new Set(['vocabulary', 'lookup', 'reading', 'review', 'exam']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RECENT_REPORT_STATUSES = new Set(['available', 'empty', 'partial', 'unavailable']);

function dateArg(args = {}) {
  const date = String(args.date || args.dateKey || '').trim();
  if (!DATE_PATTERN.test(date)) throw new TypeError('日报日期必须为 YYYY-MM-DD');
  return date;
}

export class LearningAgent {
  constructor({ db, srs, examCorpus = null, examLearningProvider = null, dailyReportProvider = null, targetTrack = () => '', now = () => Date.now() }) {
    this.db = db;
    this.srs = srs;
    this.examCorpus = examCorpus;
    this.examLearningProvider = examLearningProvider;
    this.dailyReportProvider = dailyReportProvider;
    this.targetTrack = targetTrack;
    this.now = now;
  }

  async execute(name, args = {}) {
    if (name === 'get_learning_overview') return this.getLearningOverview();
    if (name === 'get_exam_learning_overview') return this.getExamLearningOverview(args);
    if (name === 'find_learning_words') return this.findLearningWords(args.query);
    if (name === 'list_saved_articles') return this.listSavedArticles(args);
    if (name === 'get_review_queue') return this.getReviewQueue();
    if (name === 'get_exam_learning_priorities') return this.getExamLearningPriorities();
    if (name === 'get_today_learning_report') return this.getTodayLearningReport();
    if (name === 'get_daily_learning_report') return this.getDailyLearningReport(args);
    if (name === 'list_recent_learning_reports') return this.listRecentLearningReports(args);
    if (name === 'get_learning_activity_detail') return this.getLearningActivityDetail(args);
    throw new Error('Tool not allowed: ' + name);
  }

  unavailableDailyResult(source = 'daily_learning_report') {
    return { source, status: 'unavailable', completeness: 'unavailable', reports: [], items: [] };
  }

  async getDailyLearningReport(args = {}) {
    const dateKey = dateArg(args);
    if (!this.dailyReportProvider?.getOrCreate) return { ...this.unavailableDailyResult(), dateKey };
    return this.dailyReportProvider.getOrCreate(dateKey, { withAnalysis: false });
  }

  async getTodayLearningReport() {
    const dateKey = localDayKey(this.now());
    if (!this.dailyReportProvider?.getOrCreate) return { ...this.unavailableDailyResult(), dateKey };
    return this.dailyReportProvider.getOrCreate(dateKey, { withAnalysis: false });
  }

  async listRecentLearningReports(args = {}) {
    const limit = Math.max(1, Math.min(30, Math.trunc(Number(args.limit) || 30)));
    if (!this.dailyReportProvider?.listRecent) return { source: 'recent_learning_reports', status: 'unavailable', reports: [] };
    let result;
    try {
      result = await this.dailyReportProvider.listRecent(limit);
    } catch {
      return { source: 'recent_learning_reports', status: 'unavailable', reports: [] };
    }

    const isLegacyArray = Array.isArray(result);
    const reports = (isLegacyArray ? result : Array.isArray(result?.reports) ? result.reports : []).slice(0, 30);
    const providerStatus = !isLegacyArray && typeof result?.status === 'string' ? result.status : '';
    const status = RECENT_REPORT_STATUSES.has(providerStatus)
      ? providerStatus
      : reports.length ? 'available' : isLegacyArray ? 'empty' : 'unavailable';
    return { source: 'recent_learning_reports', status, reports };
  }

  async getLearningActivityDetail(args = {}) {
    const dateKey = dateArg(args);
    const category = String(args.category || '').trim();
    if (!DAILY_REPORT_CATEGORIES.has(category)) throw new TypeError('学习活动详情类别无效');
    const limit = Math.max(1, Math.min(100, Math.trunc(Number(args.limit) || 20)));
    if (!this.dailyReportProvider?.getActivityDetail) return { source: 'learning_activity_detail', status: 'unavailable', dateKey, category, items: [] };
    return this.dailyReportProvider.getActivityDetail({ dateKey, category, limit });
  }

  async getExamLearningOverview({ year, bankId } = {}) {
    if (!this.examLearningProvider?.getOverview) {
      return { source: 'exam_learning_overview', status: 'unavailable', availableYears: [], recentAttempts: [], wrongSummary: [] };
    }
    const query = { recentLimit: 5, wrongLimit: 5 };
    if (Number.isInteger(Number(year))) query.year = Number(year);
    if (typeof bankId === 'string' && bankId.trim()) query.bankId = bankId.trim();
    return this.examLearningProvider.getOverview(query);
  }

  async getLearningOverview() {
    const [words, articles, stats] = await Promise.all([
      this.db.getAllLearnWords(),
      this.db.getAllArticles(),
      this.db.getAllReadingStats()
    ]);
    const activeWords = activeLearnWords(words);
    const reading = buildReadingAnalytics({ articles, readingStats: stats, now: this.now() });
    return {
      source: 'learning_overview',
      totals: {
        words: activeWords.length,
        due: this.srs.getDueCount(activeWords),
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
    const words = activeLearnWords(await this.db.getAllLearnWords())
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
    const words = this.srs.getDueWords(activeLearnWords(await this.db.getAllLearnWords()))
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
    const words = activeLearnWords(await this.db.getAllLearnWords());
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
