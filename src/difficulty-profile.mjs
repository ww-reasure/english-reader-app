// Kept self-contained because the lightweight generation-request resolver is
// also loaded in a sandboxed data URL by the regression suite.
const CURRENT_TARGET_TRACKS = ['cet4', 'cet6', 'kaoyan1', 'kaoyan2'];
const LEGACY_TRACK = 'graduate';
const TRACKS = new Set([...CURRENT_TARGET_TRACKS, LEGACY_TRACK]);
const CHALLENGES = new Set(['support', 'standard', 'stretch']);

const normalizeStoredTrack = value => {
  const track = String(value || '').trim().toLowerCase();
  return TRACKS.has(track) ? track : 'cet4';
};

export const CHALLENGE_DETAILS = Object.freeze({
  support: { label: '巩固', coverageRange: { min: 97, max: 98 } },
  standard: { label: '对标', coverageRange: { min: 95, max: 97 } },
  stretch: { label: '加压', coverageRange: { min: 92, max: 95 } }
});

const PROFILES = {
  cet4: {
    support: { wordRange: { min: 240, max: 320 }, sentenceRange: { min: 10, max: 17 }, academicTarget: '约 5–7% 学术词（生成后待校验）' },
    standard: { wordRange: { min: 320, max: 380 }, sentenceRange: { min: 18, max: 21 }, academicTarget: '约 5.5–7.5% 学术词（生成后待校验）' },
    stretch: { wordRange: { min: 380, max: 440 }, sentenceRange: { min: 20, max: 24 }, academicTarget: '约 6.5–8% 学术词（生成后待校验）' }
  },
  cet6: {
    support: { wordRange: { min: 280, max: 360 }, sentenceRange: { min: 15, max: 19 }, academicTarget: '约 5.5–7% 学术词（生成后待校验）' },
    standard: { wordRange: { min: 360, max: 430 }, sentenceRange: { min: 19, max: 22 }, academicTarget: '约 6.5–8.5% 学术词（生成后待校验）' },
    stretch: { wordRange: { min: 430, max: 500 }, sentenceRange: { min: 21, max: 25 }, academicTarget: '约 7–9% 学术词（生成后待校验）' }
  },
  graduate: {
    support: { wordRange: { min: 340, max: 400 }, sentenceRange: { min: 16, max: 20 }, academicTarget: '考研导向学术语篇（生成后待校验）' },
    standard: { wordRange: { min: 400, max: 480 }, sentenceRange: { min: 20, max: 23 }, academicTarget: '考研导向学术语篇（生成后待校验）' },
    stretch: { wordRange: { min: 480, max: 540 }, sentenceRange: { min: 22, max: 26 }, academicTarget: '考研导向学术语篇（生成后待校验）' }
  }
  ,
  // The two graduate tracks deliberately have independent ranges and
  // syntactic baselines.  `graduate` above is compatibility-only for older
  // saved articles; new generation uses one of these tracks.
  kaoyan1: {
    support: { wordRange: { min: 340, max: 400 }, sentenceRange: { min: 16, max: 20 }, academicTarget: '约 5.5–7.5% 学术词（生成后待校验）' },
    standard: { wordRange: { min: 400, max: 480 }, sentenceRange: { min: 20, max: 23 }, academicTarget: '约 6.5–9% 学术词（生成后待校验）' },
    stretch: { wordRange: { min: 480, max: 540 }, sentenceRange: { min: 22, max: 26 }, academicTarget: '约 7.5–9.5% 学术词（生成后待校验）' }
  },
  kaoyan2: {
    support: { wordRange: { min: 320, max: 380 }, sentenceRange: { min: 15, max: 19 }, academicTarget: '约 5–6.5% 学术词（生成后待校验）' },
    standard: { wordRange: { min: 380, max: 450 }, sentenceRange: { min: 19, max: 22 }, academicTarget: '约 5.5–7.5% 学术词（生成后待校验）' },
    stretch: { wordRange: { min: 450, max: 520 }, sentenceRange: { min: 21, max: 25 }, academicTarget: '约 6.5–8% 学术词（生成后待校验）' }
  }
};

const CONTEXT_SENTENCE_RANGES = Object.freeze({
  support: { min: 8, max: 15 },
  standard: { min: 11, max: 19 },
  stretch: { min: 14, max: 22 }
});

const CONTEXT_ACADEMIC_TARGETS = Object.freeze({
  support: '低',
  standard: '适中',
  stretch: '适中偏高'
});

const CONTEXT_SYNTAX_CAPS = Object.freeze({
  support: { subordinateMarkers: 1, passiveMarkers: 0, nonFiniteMarkers: 1 },
  standard: { subordinateMarkers: 1, passiveMarkers: 1, nonFiniteMarkers: 1 },
  stretch: { subordinateMarkers: 2, passiveMarkers: 1, nonFiniteMarkers: 2 }
});

// These values are prompt/observation strategy ranges. They are deliberately
// not represented as historical-exam or corpus-derived syntax baselines: the
// provenance registry stays provisional until a permitted corpus has been run
// through the same UDPipe metric pipeline used by the app.
const SYNTAX_OBSERVATION_RANGES = {
  cet4: {
    support: { dependencyDepth: { min: 2, max: 4 }, subordinateRate: { min: 0.08, max: 0.28 }, passiveRate: { min: 0, max: 0.12 }, nonFiniteRate: { min: 0, max: 0.16 } },
    standard: { dependencyDepth: { min: 2, max: 5 }, subordinateRate: { min: 0.12, max: 0.36 }, passiveRate: { min: 0.02, max: 0.18 }, nonFiniteRate: { min: 0.03, max: 0.22 } },
    stretch: { dependencyDepth: { min: 3, max: 6 }, subordinateRate: { min: 0.16, max: 0.44 }, passiveRate: { min: 0.03, max: 0.24 }, nonFiniteRate: { min: 0.05, max: 0.28 } }
  },
  cet6: {
    support: { dependencyDepth: { min: 3, max: 5 }, subordinateRate: { min: 0.14, max: 0.38 }, passiveRate: { min: 0.03, max: 0.2 }, nonFiniteRate: { min: 0.04, max: 0.24 } },
    standard: { dependencyDepth: { min: 3, max: 6 }, subordinateRate: { min: 0.18, max: 0.46 }, passiveRate: { min: 0.04, max: 0.26 }, nonFiniteRate: { min: 0.06, max: 0.3 } },
    stretch: { dependencyDepth: { min: 4, max: 7 }, subordinateRate: { min: 0.22, max: 0.54 }, passiveRate: { min: 0.05, max: 0.32 }, nonFiniteRate: { min: 0.08, max: 0.36 } }
  },
  kaoyan1: {
    support: { dependencyDepth: { min: 3, max: 6 }, subordinateRate: { min: 0.18, max: 0.46 }, passiveRate: { min: 0.04, max: 0.26 }, nonFiniteRate: { min: 0.06, max: 0.3 } },
    standard: { dependencyDepth: { min: 4, max: 7 }, subordinateRate: { min: 0.22, max: 0.54 }, passiveRate: { min: 0.05, max: 0.32 }, nonFiniteRate: { min: 0.08, max: 0.36 } },
    stretch: { dependencyDepth: { min: 4, max: 8 }, subordinateRate: { min: 0.26, max: 0.62 }, passiveRate: { min: 0.06, max: 0.38 }, nonFiniteRate: { min: 0.1, max: 0.42 } }
  },
  kaoyan2: {
    support: { dependencyDepth: { min: 3, max: 5 }, subordinateRate: { min: 0.16, max: 0.4 }, passiveRate: { min: 0.03, max: 0.22 }, nonFiniteRate: { min: 0.05, max: 0.26 } },
    standard: { dependencyDepth: { min: 3, max: 6 }, subordinateRate: { min: 0.2, max: 0.48 }, passiveRate: { min: 0.04, max: 0.28 }, nonFiniteRate: { min: 0.07, max: 0.32 } },
    stretch: { dependencyDepth: { min: 4, max: 7 }, subordinateRate: { min: 0.24, max: 0.56 }, passiveRate: { min: 0.05, max: 0.34 }, nonFiniteRate: { min: 0.09, max: 0.38 } }
  }
};

// The legacy track needs a syntax profile only so historic generation calls
// can still be rendered/validated.  It is intentionally not selectable.
SYNTAX_OBSERVATION_RANGES.graduate = SYNTAX_OBSERVATION_RANGES.kaoyan1;
Object.freeze(SYNTAX_OBSERVATION_RANGES);

// Keep this marker in lockstep with public/data/track-baseline-registry.json.
// The registry is intentionally not loaded at generation time: the immutable
// metadata below makes the absence of an activated, same-metric corpus
// explicit in every profile passed to the validator.
const PROVISIONAL_SYNTAX_VALIDATION = Object.freeze({
  schemaVersion: 1,
  status: 'provisional',
  enforcement: 'observe',
  registryId: 'track-baseline-registry',
  registryVersion: '2026.07.26-provisional',
  reason: 'CORPUS_BASELINE_NOT_ACTIVATED',
  metricSchema: 'udpipe-dependency-v1'
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const canonical = value => String(value || '').trim().toLowerCase();

export function getDifficultyProfile(track = 'cet4', challenge = 'standard') {
  const normalizedTrack = normalizeStoredTrack(canonical(track));
  const normalizedChallenge = CHALLENGES.has(canonical(challenge)) ? canonical(challenge) : 'standard';
  const challengeDetails = CHALLENGE_DETAILS[normalizedChallenge];
  const syntaxValidation = createProvisionalSyntaxValidation(normalizedTrack, normalizedChallenge);
  return {
    track: normalizedTrack,
    challenge: normalizedChallenge,
    ...PROFILES[normalizedTrack][normalizedChallenge],
    syntaxRange: createSyntaxObservationRange(normalizedTrack, normalizedChallenge, syntaxValidation),
    syntaxValidation,
    coverageRange: { ...challengeDetails.coverageRange },
    coverageLabel: challengeDetails.label
  };
}

function createProvisionalSyntaxValidation(track, challenge) {
  return {
    ...PROVISIONAL_SYNTAX_VALIDATION,
    track,
    challenge
  };
}

function createSyntaxObservationRange(track, challenge, validation) {
  const range = SYNTAX_OBSERVATION_RANGES[track]?.[challenge] || SYNTAX_OBSERVATION_RANGES.cet4.standard;
  return {
    dependencyDepth: { ...range.dependencyDepth },
    subordinateRate: { ...range.subordinateRate },
    passiveRate: { ...range.passiveRate },
    nonFiniteRate: { ...range.nonFiniteRate },
    // `validateGrammarAnalysis` accepts legacy bare ranges too. New app
    // profiles carry this metadata so uncalibrated strategy drift is observed
    // rather than incorrectly promoted to a save-blocking exam threshold.
    validation: { ...validation }
  };
}

/**
 * A reader can move the coverage inside the safe recommendation band, but the
 * app never converts that choice into a claim about their vocabulary size.
 */
export function normalizeCoveragePreference(challenge = 'standard', coverage) {
  const normalizedChallenge = CHALLENGES.has(challenge) ? challenge : 'standard';
  const range = CHALLENGE_DETAILS[normalizedChallenge].coverageRange;
  const requested = Number.parseFloat(coverage);
  const midpoint = (range.min + range.max) / 2;
  const resolved = clamp(Number.isFinite(requested) ? Math.round(requested) : Math.round(midpoint), range.min, range.max);
  return {
    challenge: normalizedChallenge,
    coverage: resolved,
    range: { ...range },
    adjusted: Number.isFinite(requested) && Math.round(requested) !== resolved
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

/**
 * Context review is deliberately a smaller projection of the same global
 * target. The learning word is required but excluded from the surrounding
 * vocabulary coverage expectation, so difficult words remain reviewable in
 * an otherwise readable sentence.
 */
export function resolveContextDifficultyProfile(challenge = 'standard', coverage = undefined) {
  const normalizedChallenge = CHALLENGES.has(canonical(challenge)) ? canonical(challenge) : 'standard';
  const coveragePreference = normalizeCoveragePreference(normalizedChallenge, coverage);
  const sentenceRange = CONTEXT_SENTENCE_RANGES[normalizedChallenge] || CONTEXT_SENTENCE_RANGES.standard;
  const syntaxCaps = CONTEXT_SYNTAX_CAPS[normalizedChallenge] || CONTEXT_SYNTAX_CAPS.standard;
  const modeGuidance = {
    support: '优先使用高覆盖率常用词和直接语序。',
    standard: '保持自然、清晰的说明或评论语境。',
    stretch: '在不堆砌生词的前提下加入更紧凑的论证和句法关系。'
  }[normalizedChallenge] || '';

  return {
    key: `context-v2:${normalizedChallenge}:c${coveragePreference.coverage}`,
    challenge: normalizedChallenge,
    sentenceRange: { ...sentenceRange },
    coverageRange: { ...coveragePreference.range },
    coverage: coveragePreference.coverage,
    academicTarget: CONTEXT_ACADEMIC_TARGETS[normalizedChallenge] || CONTEXT_ACADEMIC_TARGETS.standard,
    syntaxCaps: { ...syntaxCaps },
    targetWordExcluded: true,
    promptGuidance: modeGuidance
  };
}

export function formatProfileConstraints(profile) {
  const normalized = getDifficultyProfile(profile?.track, profile?.challenge);
  const academicTarget = String(normalized.academicTarget || '').replaceAll('–', '-');

  return `以下为生成规格：
- 硬性校验：总字数必须控制在 ${normalized.wordRange.min}-${normalized.wordRange.max} 词
- 硬性校验：平均句长必须控制在 ${normalized.sentenceRange.min}-${normalized.sentenceRange.max} 词
- 词汇方向（观察指标，不是未经校准的真题阈值）：${academicTarget}
- 句法方向仅记录本地依存句法指标；语料基线尚未激活，不宣称与真题等值。`;
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
