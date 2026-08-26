import {
  DAILY_REPORT_SCHEMA_VERSION,
  buildDailyLearningReport,
  formatDailyLearningReportMarkdown,
  toDailyReportAgentSummary
} from './daily-learning-report.mjs';
import { ActivityType } from './learning-activity.mjs';
import { isDayRetained, localDayBounds, localDayKey } from './learning-day.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REPORT_DAYS = 30;
const MAX_ACTIVITY_DAYS = 35;
const MAX_ANALYSIS_CHARS = 6000;
const MAX_DETAIL_LIMIT = 100;
const CHINESE = /[\u3400-\u9fff]/u;

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

function hasChinese(value) {
  return CHINESE.test(text(value));
}

function clip(value, limit) {
  return text(value).slice(0, limit);
}

function normalizeAnalysis(value) {
  if (!value) return null;
  let summary = '';
  let observations = [];
  let nextActions = [];
  if (typeof value === 'string') {
    const lines = value.split(/\r?\n/).map(text).filter(Boolean);
    const observationStart = lines.findIndex(line => /观察|发现|表现/.test(line));
    const actionStart = lines.findIndex(line => /明日|建议|行动/.test(line));
    summary = lines.find(line => !/^[-*\d.)、\s]/.test(line) && !/观察|发现|表现|明日|建议|行动/.test(line)) || lines[0] || '';
    if (observationStart >= 0) {
      const end = actionStart > observationStart ? actionStart : lines.length;
      observations = lines.slice(observationStart + 1, end).map(line => line.replace(/^[-*\d.)、\s]+/, '')).filter(Boolean);
    }
    if (actionStart >= 0) nextActions = lines.slice(actionStart + 1).map(line => line.replace(/^[-*\d.)、\s]+/, '')).filter(Boolean);
  } else if (typeof value === 'object') {
    summary = value.summary || value.overview || value.conclusion || '';
    observations = value.observations || value.observation || value.findings || [];
    nextActions = value.nextActions || value.actions || value.recommendations || [];
  }
  summary = clip(summary, 1200);
  observations = asArray(observations).map(item => clip(item, 700)).filter(Boolean).slice(0, 4);
  nextActions = asArray(nextActions).map(item => clip(item, 700)).filter(Boolean).slice(0, 4);
  const combined = [summary, ...observations, ...nextActions].join('\n');
  if (!summary || observations.length < 2 || nextActions.length < 2 || !hasChinese(combined)) return null;
  const normalized = { summary, observations, nextActions };
  if (text(JSON.stringify(normalized)).length > MAX_ANALYSIS_CHARS) {
    normalized.summary = clip(normalized.summary, 800);
    normalized.observations = normalized.observations.map(item => clip(item, 400));
    normalized.nextActions = normalized.nextActions.map(item => clip(item, 400));
  }
  return text(JSON.stringify(normalized)).length <= MAX_ANALYSIS_CHARS ? normalized : null;
}

function analysisText(analysis) {
  if (!analysis) return '';
  return [
    analysis.summary,
    '',
    '观察：',
    ...analysis.observations.map(item => `- ${item}`),
    '',
    '明日建议：',
    ...analysis.nextActions.map(item => `- ${item}`)
  ].join('\n');
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
    'scheduleChanged', 'reason', 'counts', 'recovery'
  ]) {
    if (payload[key] !== undefined) item[key] = key === 'articleTitle' ? clip(payload[key], 120) : payload[key];
  }
  return item;
}

function categoryTypes(category) {
  const map = {
    vocabulary: [ActivityType.WORD_IMPORT_DAILY, ActivityType.WORD_IMPORT_BATCH, ActivityType.READING_WORD_SAVED],
    lookup: [ActivityType.READING_WORD_LOOKUP],
    reading: [ActivityType.READING_WORD_LOOKUP, ActivityType.READING_WORD_SAVED],
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

export class DailyLearningReportService {
  constructor({ db, examProvider, analyze = null, now = () => Date.now() } = {}) {
    if (!db) throw new TypeError('日报服务需要 DB');
    if (!examProvider) throw new TypeError('日报服务需要真题事实 provider');
    this.db = db;
    this.examProvider = examProvider;
    this.analyze = typeof analyze === 'function' ? analyze : null;
    this.now = typeof now === 'function' ? now : () => Date.now();
  }

  nowMs() {
    const value = Number(this.now());
    return Number.isFinite(value) ? value : Date.now();
  }

  async loadReviewEvents(learnWords) {
    if (typeof this.db.getAllReviewEvents === 'function') {
      return normalizeReviewEvents(await this.db.getAllReviewEvents());
    }
    if (typeof this.db.listReviewEvents === 'function') {
      return normalizeReviewEvents(await this.db.listReviewEvents());
    }
    if (typeof this.db.getReviewEventsForWord !== 'function') return [];
    const groups = await Promise.all(asArray(learnWords).map(word => this.db.getReviewEventsForWord(word.id).catch(() => [])));
    return normalizeReviewEvents(groups.flat());
  }

  async loadExamFacts({ dateKey, from, to }) {
    const provider = this.examProvider;
    for (const method of ['getDailyFacts', 'getFacts', 'loadFacts']) {
      if (typeof provider?.[method] === 'function') {
        const result = await provider[method]({ dateKey, from, to, now: this.nowMs() });
        return result?.facts && typeof result.facts === 'object' ? result.facts : (result || {});
      }
    }
    if (typeof provider?.getOverview === 'function') return provider.getOverview({ dateKey, from, to });
    return {};
  }

  async loadFacts(dateKey) {
    const { from, to } = dayRange(dateKey);
    const [articles, readingStats, learnWords, activities, recentReports, examFacts] = await Promise.all([
      callOptional(this.db, 'getAllArticles', []),
      callOptional(this.db, 'getAllReadingStats', []),
      callOptional(this.db, 'getAllLearnWords', [], { includeArchived: true }),
      callOptional(this.db, 'listLearningActivities', [], { from, to }),
      callOptional(this.db, 'listDailyLearningReports', [], { limit: MAX_REPORT_DAYS }),
      this.loadExamFacts({ dateKey, from, to })
    ]);
    const reviewEvents = await this.loadReviewEvents(learnWords);
    return {
      dateKey,
      articles,
      readingStats,
      learnWords,
      reviewEvents,
      activities,
      papers: asArray(examFacts.papers),
      attempts: asArray(examFacts.attempts),
      responsesByAttempt: examFacts.responsesByAttempt || {},
      wrongStates: asArray(examFacts.wrongStates),
      translationReviews: asArray(examFacts.translationReviews),
      recentReports: asArray(recentReports).map(item => item?.facts || item?.data || item).filter(Boolean),
      now: this.nowMs()
    };
  }

  async fingerprint(report) {
    const { generatedAt, aiAnalysis, ...facts } = report || {};
    return sha256Fingerprint({ schemaVersion: DAILY_REPORT_SCHEMA_VERSION, facts });
  }

  async requestAnalysis(report, signal) {
    if (!this.analyze) return null;
    if (signal?.aborted) throw Object.assign(new Error('日报分析已取消'), { name: 'AbortError' });
    const request = {
      dateKey: report.dateKey,
      facts: toDailyReportAgentSummary(report),
      instructions: '请用中文返回 JSON：summary 为一段总结；observations 为 2-4 条观察；nextActions 为 2-4 条明日行动。不要复述文章、题干、答案或对话原文。'
    };
    const result = await this.analyze(request, { signal });
    if (signal?.aborted) throw Object.assign(new Error('日报分析已取消'), { name: 'AbortError' });
    return normalizeAnalysis(result);
  }

  async getOrCreate(dateKey, { withAnalysis = false, signal = null } = {}) {
    const now = this.nowMs();
    assertDateInRetention(dateKey, now);
    const [facts, cached] = await Promise.all([
      this.loadFacts(dateKey),
      callOptional(this.db, 'getDailyLearningReport', null, dateKey)
    ]);
    const report = buildDailyLearningReport(facts);
    const dataFingerprint = await this.fingerprint(report);
    const cachedAnalysis = cached?.analysisStatus === 'available'
      && cached.dataFingerprint === dataFingerprint
      && cached.aiAnalysis;
    if (cached && cached.dataFingerprint === dataFingerprint && (!withAnalysis || cachedAnalysis)) return cached;

    let aiAnalysis = null;
    let analysisStatus = 'unavailable';
    if (withAnalysis && this.analyze) {
      try {
        aiAnalysis = await this.requestAnalysis(report, signal);
        if (aiAnalysis) analysisStatus = 'available';
      } catch {
        aiAnalysis = null;
      }
    }
    const markdownReport = aiAnalysis
      ? { ...report, aiAnalysis: { text: analysisText(aiAnalysis), summary: aiAnalysis.summary } }
      : report;
    const stored = {
      dateKey,
      schemaVersion: DAILY_REPORT_SCHEMA_VERSION,
      updatedAt: now,
      expiresAt: localDayBounds(dateShift(dateKey, MAX_REPORT_DAYS)).end,
      dataFingerprint,
      facts: report,
      markdown: formatDailyLearningReportMarkdown(markdownReport),
      analysisStatus,
      aiAnalysis
    };
    return this.db.saveDailyLearningReport(stored);
  }

  async getActivityDetail({ dateKey, category, limit = 20 } = {}) {
    const now = this.nowMs();
    assertDateInRetention(dateKey, now);
    const types = categoryTypes(text(category));
    if (!types) throw new TypeError('日报详情类别无效');
    const { from, to } = dayRange(dateKey);
    const rows = await callOptional(this.db, 'listLearningActivities', [], { from, to, types });
    const items = asArray(rows)
      .filter(item => types.includes(item.type))
      .slice(0, Math.max(0, Math.min(MAX_DETAIL_LIMIT, Math.trunc(Number(limit) || 20))))
      .map(sanitizeActivity);
    return {
      source: 'learning_activity_detail',
      dateKey,
      category: text(category),
      completeness: rows ? 'complete' : 'unavailable',
      items,
      limit: Math.max(0, Math.min(MAX_DETAIL_LIMIT, Math.trunc(Number(limit) || 20)))
    };
  }

  async listRecent(limit = 30) {
    const capped = Math.max(0, Math.min(MAX_REPORT_DAYS, Math.trunc(Number(limit) || 30)));
    const rows = await callOptional(this.db, 'listDailyLearningReports', [], { limit: capped });
    return asArray(rows).slice(0, capped).map(item => ({
      dateKey: text(item.dateKey),
      updatedAt: Number(item.updatedAt) || 0,
      expiresAt: Number(item.expiresAt) || 0,
      dataFingerprint: text(item.dataFingerprint),
      analysisStatus: text(item.analysisStatus || 'unavailable'),
      coreStudyDurationMs: positive(item.facts?.coreStudyDurationMs || item.coreStudyDurationMs),
      completeness: { ...(item.facts?.completeness || item.completeness || {}) },
      summary: clip(item.aiAnalysis?.summary, 240)
    }));
  }

  async prune() {
    const now = this.nowMs();
    const todayKey = localDayKey(now);
    const reportBefore = localDayBounds(dateShift(todayKey, -(MAX_REPORT_DAYS - 1))).start;
    const activityBefore = localDayBounds(dateShift(todayKey, -(MAX_ACTIVITY_DAYS - 1))).start;
    return this.db.deleteExpiredLearningTelemetry({ reportBefore, activityBefore });
  }
}

export { normalizeAnalysis, stableStringify };
