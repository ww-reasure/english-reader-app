import { resolveArticleTrack } from './cloud-article-metadata.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const DIFFICULTY_KEYS = ['cet4', 'cet6', 'kaoyan1', 'kaoyan2', 'kaoyan-general', 'graduate'];

const asNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const asTimestamp = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function isEffectiveReading(stat = {}) {
  return Number(stat.qualificationVersion) >= 2 && stat.completed === true;
}

export function effectiveReadings(readingStats = []) {
  return (Array.isArray(readingStats) ? readingStats : [])
    .filter(isEffectiveReading)
    .sort((left, right) => asTimestamp(right.createdAt) - asTimestamp(left.createdAt));
}

function readingWordCount(reading = {}) {
  return Math.max(0, Math.round(asNumber(reading.wordCount || reading.articleSnapshot?.wordCount)));
}

function readingSeconds(reading = {}) {
  return Math.max(0, Math.round(asNumber(reading.activeSeconds || reading.elapsed)));
}

function readingDifficulty(reading = {}, articleById = new Map()) {
  const snapshot = reading.articleSnapshot || {};
  const article = articleById.get(reading.articleId);
  if (article) {
    const articleTarget = resolveArticleTrack(article).targetTrack;
    if (articleTarget !== 'unknown') return articleTarget;
  }

  const snapshotTarget = String(snapshot.targetTrack || '').trim();
  if (snapshotTarget) return resolveArticleTrack({ ...snapshot, targetTrack: snapshotTarget }).targetTrack;

  return resolveArticleTrack(snapshot).targetTrack;
}

function dayKey(timestamp) {
  const day = new Date(timestamp);
  return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
}

export function calculateEffectiveReadingStreak(readingStats = [], now = Date.now()) {
  const readDays = new Set(effectiveReadings(readingStats).map(reading => dayKey(reading.createdAt)));
  if (!readDays.size) return 0;

  const today = new Date(now);
  const todayKey = dayKey(today.getTime());
  const startOffset = readDays.has(todayKey) ? 0 : 1;
  let streak = 0;
  for (let offset = startOffset; offset < 365; offset += 1) {
    const candidate = new Date(today.getTime() - offset * DAY_MS);
    if (!readDays.has(dayKey(candidate.getTime()))) break;
    streak += 1;
  }
  return streak;
}

export function summarizeReadingPeriod(readingStats = [], startsAt = 0) {
  const readings = effectiveReadings(readingStats).filter(reading => asTimestamp(reading.createdAt) >= asTimestamp(startsAt));
  const totalSeconds = readings.reduce((total, reading) => total + readingSeconds(reading), 0);
  const totalWpm = readings.reduce((total, reading) => total + Math.max(0, asNumber(reading.wpm)), 0);
  return {
    effectiveReadingCount: readings.length,
    distinctReadArticleCount: new Set(readings.map(reading => String(reading.articleId)).filter(Boolean)).size,
    totalWords: readings.reduce((total, reading) => total + readingWordCount(reading), 0),
    totalSeconds,
    averageWpm: readings.length ? Math.round(totalWpm / readings.length) : 0
  };
}

export function buildReadingAnalytics({ articles = [], readingStats = [], now = Date.now() } = {}) {
  const library = Array.isArray(articles) ? articles : [];
  const articleById = new Map(library.map(article => [article.id, article]));
  const readings = effectiveReadings(readingStats);
  const difficultyDistribution = Object.fromEntries(DIFFICULTY_KEYS.map(key => [key, 0]));
  for (const reading of readings) {
    const difficulty = readingDifficulty(reading, articleById);
    difficultyDistribution[difficulty] = (difficultyDistribution[difficulty] || 0) + 1;
  }

  const aggregate = summarizeReadingPeriod(readings, 0);
  const recent30Start = asTimestamp(now) - 30 * DAY_MS;
  return {
    libraryArticleCount: library.length,
    effectiveReadingCount: aggregate.effectiveReadingCount,
    distinctReadArticleCount: aggregate.distinctReadArticleCount,
    recent30EffectiveReadingCount: readings.filter(reading => asTimestamp(reading.createdAt) >= recent30Start).length,
    totalWords: aggregate.totalWords,
    totalSeconds: aggregate.totalSeconds,
    averageWpm: aggregate.averageWpm,
    totalLookups: readings.reduce((total, reading) => total + Math.max(0, Math.round(asNumber(reading.clickCount))), 0),
    difficultyDistribution,
    streak: calculateEffectiveReadingStreak(readings, now),
    recentReadings: readings.map(reading => ({
      ...reading,
      article: articleById.get(reading.articleId) || null,
      title: reading.articleSnapshot?.title || articleById.get(reading.articleId)?.title || '未命名文章',
      difficulty: readingDifficulty(reading, articleById)
    }))
  };
}
