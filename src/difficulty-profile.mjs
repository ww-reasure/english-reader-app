const TRACKS = new Set(['cet4', 'cet6', 'graduate']);
const CHALLENGES = new Set(['support', 'standard', 'stretch']);

const PROFILES = {
  cet4: {
    support: { wordRange: { min: 240, max: 320 }, sentenceRange: { min: 10, max: 17 }, academicTarget: '约 5–7% 学术词（生成后待校验）' },
    standard: { wordRange: { min: 320, max: 420 }, sentenceRange: { min: 14, max: 22 }, academicTarget: '约 6–7% 学术词（生成后待校验）' },
    stretch: { wordRange: { min: 380, max: 480 }, sentenceRange: { min: 18, max: 27 }, academicTarget: '约 7–8% 学术词（生成后待校验）' }
  },
  cet6: {
    support: { wordRange: { min: 300, max: 420 }, sentenceRange: { min: 14, max: 22 }, academicTarget: '约 6–7% 学术词（生成后待校验）' },
    standard: { wordRange: { min: 380, max: 500 }, sentenceRange: { min: 18, max: 27 }, academicTarget: '约 7–8% 学术词（生成后待校验）' },
    stretch: { wordRange: { min: 450, max: 560 }, sentenceRange: { min: 22, max: 32 }, academicTarget: '约 8–9% 学术词（生成后待校验）' }
  },
  graduate: {
    support: { wordRange: { min: 340, max: 460 }, sentenceRange: { min: 16, max: 25 }, academicTarget: '考研导向学术语篇（生成后待校验）' },
    standard: { wordRange: { min: 420, max: 560 }, sentenceRange: { min: 20, max: 30 }, academicTarget: '考研导向学术语篇（生成后待校验）' },
    stretch: { wordRange: { min: 500, max: 650 }, sentenceRange: { min: 24, max: 35 }, academicTarget: '考研导向学术语篇（生成后待校验）' }
  }
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const canonical = value => String(value || '').trim().toLowerCase();

export function getDifficultyProfile(track = 'cet4', challenge = 'standard') {
  const normalizedTrack = TRACKS.has(track) ? track : 'cet4';
  const normalizedChallenge = CHALLENGES.has(challenge) ? challenge : 'standard';
  return {
    track: normalizedTrack,
    challenge: normalizedChallenge,
    ...PROFILES[normalizedTrack][normalizedChallenge]
  };
}

export function normalizeGenerationRequest({ track, challenge, wordCount } = {}) {
  const profile = getDifficultyProfile(track, challenge);
  const requested = Number.parseInt(wordCount, 10);
  const midpoint = Math.round((profile.wordRange.min + profile.wordRange.max) / 2);
  return {
    track: profile.track,
    challenge: profile.challenge,
    wordCount: clamp(Number.isFinite(requested) ? requested : midpoint, profile.wordRange.min, profile.wordRange.max),
    profile
  };
}

export function formatProfileConstraints(profile) {
  const normalized = getDifficultyProfile(profile?.track, profile?.challenge);
  const academicTarget = String(normalized.academicTarget || '').replaceAll('–', '-');

  return `以下为硬性校验目标，所有要求必须同时满足：
- 总字数必须控制在 ${normalized.wordRange.min}-${normalized.wordRange.max} 词
- 平均句长必须控制在 ${normalized.sentenceRange.min}-${normalized.sentenceRange.max} 词
- ${academicTarget}`;
}

export function analyzeArticle(content = '', targetWords = []) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  const words = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
  const sentences = text.split(/(?<=[.!?])\s+/).map(sentence => sentence.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).filter(sentence => sentence.length);
  const lowerWords = words.map(word => word.toLowerCase());
  const targetWordCounts = Object.fromEntries(
    [...new Set(targetWords.map(canonical).filter(Boolean))]
      .map(target => [target, lowerWords.filter(word => word === target).length])
  );

  return {
    wordCount: words.length,
    sentenceCount: sentences.length,
    averageSentenceLength: sentences.length ? Math.round((words.length / sentences.length) * 10) / 10 : 0,
    targetWordCounts
  };
}

export function validateArticle(content, profile, targetWords = []) {
  const metrics = analyzeArticle(content, targetWords);
  const deviations = [];
  if (metrics.wordCount < profile.wordRange.min || metrics.wordCount > profile.wordRange.max) {
    deviations.push({ code: 'word_count', expected: profile.wordRange, actual: metrics.wordCount });
  }
  if (metrics.sentenceCount && (metrics.averageSentenceLength < profile.sentenceRange.min || metrics.averageSentenceLength > profile.sentenceRange.max)) {
    deviations.push({ code: 'sentence_length', expected: profile.sentenceRange, actual: metrics.averageSentenceLength });
  }
  for (const [word, count] of Object.entries(metrics.targetWordCounts)) {
    if (count === 0) deviations.push({ code: 'target_word', word, actual: 0 });
  }
  return { passed: deviations.length === 0, metrics, deviations, profile };
}

export const DifficultyProfiles = PROFILES;
