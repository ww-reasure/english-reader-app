import {
  DAILY_REPORT_SCHEMA_VERSION,
  buildDailyLearningReport,
  formatDailyLearningReportMarkdown
} from './daily-learning-report.mjs';
import { ActivityType, Completeness } from './learning-activity.mjs';
import { isDayRetained, localDayBounds, localDayKey } from './learning-day.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REPORT_DAYS = 30;
const MAX_ACTIVITY_DAYS = 35;
const MAX_DETAIL_LIMIT = 100;

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const positive = value => Math.max(0, Number(value) || 0);
const asArray = value => Array.isArray(value) ? value : [];

function stableStringify(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item) ?? 'null').join(',')}]`;
  const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

async function sha256Fingerprint(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('当前环境不支持日报指纹');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(value)));
  const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

function dateShift(dateKey, offset) {
  const date = new Date(localDayBounds(dateKey).start);
  date.setDate(date.getDate() + Number(offset || 0));
  return localDayKey(date.getTime());
}

function assertDateInRetention(dateKey, nowMs) {
  try {
    localDayBounds(dateKey);
  } catch {
    throw new TypeError('日报日期格式无效');
  }
  if (!isDayRetained(dateKey, { now: nowMs, days: MAX_REPORT_DAYS })) {
    throw new Error('日报日期已过期或尚未到达');
  }
}

function dayRange(dateKey) {
  const bounds = localDayBounds(dateKey);
  return { from: bounds.start, to: bounds.end };
}

function normalizeReviewEvents(events) {
  const map = new Map();
  for (const event of asArray(events)) {
    const key = event?.id ?? `${event?.wordId || ''}:${event?.reviewedAt || ''}:${event?.source || ''}`;
    if (!map.has(key)) map.set(key, event);
  }
  return [...map.values()];
}

function clip(value, limit) {
  return text(value).slice(0, limit);
}

function sanitizeActivity(activity) {
  const payload = activity?.payload && typeof activity.payload === 'object' ? activity.payload : {};
  const item = {
    id: text(activity?.id),
    type: text(activity?.type),
    occurredAt: Number(activity?.occurredAt) || 0,
    dayKey: text(activity?.dayKey),
    sessionId: text(activity?.sessionId)
  };
  for (const key of [
    'lemma', 'status', 'source', 'articleId', 'articleTitle', 'createdLearnWord',
    'durationMs', 'mode', 'scope', 'contextKey', 'attemptId', 'bankId',
    'paperKey', 'unitKey', 'type', 'matchingVariant', 'practiceKind', 'practiceOrigin',
    'scheduleChanged', 'reason', 'counts', 'recovery', 'completionId',
    'maxContentProgress', 'guideVisitedCount', 'lastMode', 'completedToday'
  ]) {
    if (payload[key] !== undefined) item[key] = key === 'articleTitle' ? clip(payload[key], 120) : payload[key];
  }
  return item;
}

function categoryTypes(category) {
  const map = {
    vocabulary: [ActivityType.WORD_IMPORT_DAILY, ActivityType.WORD_IMPORT_BATCH, ActivityType.READING_WORD_SAVED],
    lookup: [ActivityType.READING_WORD_LOOKUP],
    reading: [ActivityType.READING_WORD_LOOKUP, ActivityType.READING_WORD_SAVED, ActivityType.READING_ACTIVE_SLICE],
    review: [ActivityType.REVIEW_SESSION_SUMMARY],
    exam: [ActivityType.EXAM_ACTIVE_SLICE]
  };
  return map[category] || null;
}

async function callOptional(target, method, fallback, ...args) {
  if (typeof target?.[method] !== 'function') return fallback;
  try {
    return await target[method](...args);
  } catch {
    return fallback;
  }
}

async function readSource(target, method, fallback, ...args) {
  if (typeof target?.[method] !== 'function') return { ok: false, value: fallback };
  try {
    return { ok: true, value: await target[method](...args) };
  } catch {
    return { ok: false, value: fallback };
  }
}

function arraySourceStatus(source, rows) {
  if (!source.ok) return Completeness.UNAVAILABLE;
  return rows.length ? Completeness.AVAILABLE : Completeness.EMPTY;
}

export class DailyLearningReportService {
  constructor({ db, examProvider, now = () => Date.now() } = {}) {
    if (!db) throw new TypeError('日报服务需要 DB');
    if (!examProvider) throw new TypeError('日报服务需要真题事实 provider');
    this.db = db;
    this.examProvider = examProvider;
    this.now = typeof now === 'function' ? now : () => Date.now();
  }

  nowMs() {
    const value = Number(this.now());
    return Number.isFinite(value) ? value : Date.now();
  }

  async loadReviewEvents(learnWords) {
    if (typeof this.db.getAllReviewEvents === 'function') {
      const source = await readSource(this.db, 'getAllReviewEvents', []);
      const events = normalizeReviewEvents(source.value);
      return { events, status: arraySourceStatus(source, events) };
    }
    if (typeof this.db.listReviewEvents === 'function') {
      const source = await readSource(this.db, 'listReviewEvents', []);
      const events = normalizeReviewEvents(source.value);
      return { events, status: arraySourceStatus(source, events) };
    }
    if (typeof this.db.getReviewEventsForWord !== 'function') {
      return { events: [], status: Completeness.UNAVAILABLE };
    }
    const sources = await Promise.all(asArray(learnWords).map(word => readSource(this.db, 'getReviewEventsForWord', [], word.id)));
    const events = normalizeReviewEvents(sources.flatMap(source => asArray(source.value)));
    return {
      events,
      status: sources.some(source => !source.ok)
        ? Completeness.UNAVAILABLE
        : arraySourceStatus({ ok: true }, events)
    };
  }

  async loadExamFacts({ dateKey, from, to }) {
    const provider = this.examProvider;
    for (const method of ['getDailyFacts', 'getFacts', 'loadFacts']) {
      if (typeof provider?.[method] === 'function') {
        const source = await readSource(provider, method, {}, { dateKey, from, to, now: this.nowMs() });
        const result = source.value;
        const facts = result?.facts && typeof result.facts === 'object' ? result.facts : (result || {});
        return { facts: facts && typeof facts === 'object' ? facts : {}, status: source.ok ? Completeness.AVAILABLE : Completeness.UNAVAILABLE };
      }
    }
    if (typeof provider?.getOverview === 'function') {
      const source = await readSource(provider, 'getOverview', {}, { dateKey, from, to });
      const facts = source.value;
      return { facts: facts && typeof facts === 'object' ? facts : {}, status: source.ok ? Completeness.AVAILABLE : Completeness.UNAVAILABLE };
    }
    return { facts: {}, status: Completeness.UNAVAILABLE };
  }

  async loadFacts(dateKey) {
    const { from, to } = dayRange(dateKey);
    const [articlesSource, readingStatsSource, learnWordsSource, activitiesSource, recentReportsSource, examSource] = await Promise.all([
      readSource(this.db, 'getAllArticles', []),
      readSource(this.db, 'getAllReadingStats', []),
      readSource(this.db, 'getAllLearnWords', [], { includeArchived: true }),
      readSource(this.db, 'listLearningActivities', [], { from, to }),
      readSource(this.db, 'listDailyLearningReports', [], { limit: MAX_REPORT_DAYS }),
      this.loadExamFacts({ dateKey, from, to })
    ]);
    const articles = asArray(articlesSource.value);
    const readingStats = asArray(readingStatsSource.value);
    const learnWords = asArray(learnWordsSource.value);
    const activities = asArray(activitiesSource.value);
    const recentReports = asArray(recentReportsSource.value);
    const reviewSource = await this.loadReviewEvents(learnWords);
    return {
      dateKey,
      articles,
      readingStats,
      learnWords,
      reviewEvents: reviewSource.events,
      activities,
      papers: asArray(examSource.facts.papers),
      attempts: asArray(examSource.facts.attempts),
      responsesByAttempt: examSource.facts.responsesByAttempt || {},
      wrongStates: asArray(examSource.facts.wrongStates),
      translationReviews: asArray(examSource.facts.translationReviews),
      recentReports: recentReports.map(item => item?.facts || item?.data || item).filter(Boolean),
      sourceStatus: {
        articles: arraySourceStatus(articlesSource, articles),
        readingStats: arraySourceStatus(readingStatsSource, readingStats),
        learnWords: arraySourceStatus(learnWordsSource, learnWords),
        activities: arraySourceStatus(activitiesSource, activities),
        reviewEvents: reviewSource.status,
        examFacts: examSource.status,
        recentReports: arraySourceStatus(recentReportsSource, recentReports)
      },
      now: this.nowMs()
    };
  }

  async fingerprint(report) {
    const { generatedAt, aiAnalysis, ...facts } = report || {};
    return sha256Fingerprint({ schemaVersion: DAILY_REPORT_SCHEMA_VERSION, facts });
  }

  async getOrCreate(dateKey) {
    const now = this.nowMs();
    assertDateInRetention(dateKey, now);
    const [facts, cached] = await Promise.all([
      this.loadFacts(dateKey),
      callOptional(this.db, 'getDailyLearningReport', null, dateKey)
    ]);
    const report = buildDailyLearningReport(facts);
    const dataFingerprint = await this.fingerprint(report);
    if (cached && cached.dataFingerprint === dataFingerprint) return cached;

    const stored = {
      dateKey,
      schemaVersion: DAILY_REPORT_SCHEMA_VERSION,
      updatedAt: now,
      expiresAt: localDayBounds(dateShift(dateKey, MAX_REPORT_DAYS)).end,
      dataFingerprint,
      facts: report,
      markdown: formatDailyLearningReportMarkdown(report),
      analysisStatus: 'unavailable',
      aiAnalysis: null
    };
    return this.db.saveDailyLearningReport(stored);
  }

  async getActivityDetail({ dateKey, category, limit = 20 } = {}) {
    const now = this.nowMs();
    assertDateInRetention(dateKey, now);
    const types = categoryTypes(text(category));
    if (!types) throw new TypeError('日报详情类别无效');
    const { from, to } = dayRange(dateKey);
    const source = await readSource(this.db, 'listLearningActivities', [], { from, to, types });
    const items = asArray(source.value)
      .filter(item => types.includes(item.type))
      .slice(0, Math.max(0, Math.min(MAX_DETAIL_LIMIT, Math.trunc(Number(limit) || 20))))
      .map(sanitizeActivity);
    return {
      source: 'learning_activity_detail',
      dateKey,
      category: text(category),
      completeness: !source.ok
        ? Completeness.UNAVAILABLE
        : items.length ? Completeness.AVAILABLE : Completeness.EMPTY,
      items,
      limit: Math.max(0, Math.min(MAX_DETAIL_LIMIT, Math.trunc(Number(limit) || 20)))
    };
  }

  async listRecent(limit = 30) {
    const capped = Math.max(0, Math.min(MAX_REPORT_DAYS, Math.trunc(Number(limit) || 30)));
    const source = await readSource(this.db, 'listDailyLearningReports', [], { limit: capped });
    const reports = asArray(source.value).slice(0, capped).map(item => ({
      dateKey: text(item.dateKey),
      updatedAt: Number(item.updatedAt) || 0,
      expiresAt: Number(item.expiresAt) || 0,
      dataFingerprint: text(item.dataFingerprint),
      analysisStatus: text(item.analysisStatus || 'unavailable'),
      coreStudyDurationMs: positive(item.facts?.coreStudyDurationMs || item.coreStudyDurationMs),
      completeness: { ...(item.facts?.completeness || item.completeness || {}) },
      summary: clip(item.aiAnalysis?.summary, 240)
    }));
    return {
      status: !source.ok
        ? Completeness.UNAVAILABLE
        : reports.length ? Completeness.AVAILABLE : Completeness.EMPTY,
      reports
    };
  }

  async prune() {
    const now = this.nowMs();
    const todayKey = localDayKey(now);
    const reportBefore = localDayBounds(dateShift(todayKey, -(MAX_REPORT_DAYS - 1))).start;
    const activityBefore = localDayBounds(dateShift(todayKey, -(MAX_ACTIVITY_DAYS - 1))).start;
    return this.db.deleteExpiredLearningTelemetry({ reportBefore, activityBefore });
  }
}

export { stableStringify };
