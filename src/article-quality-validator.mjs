import { validateArticle as defaultBaseValidate } from './difficulty-profile.mjs';
import { validateGrammarAnalysis } from './grammar-validation.mjs';

const WORD_PATTERN = /[A-Za-z]+(?:['’'-][A-Za-z]+)*/g;
const WORD_TOKEN_PATTERN = /^[A-Za-z]+(?:['’'-][A-Za-z]+)*$/;
const SAFE_REASON = /^[A-Z0-9_:-]+$/;
// Proper names, numbers and non-word UD tokens should not dilute a reader's
// expected lexical coverage. Other UPOS values (including function words) are
// still meaningful reading vocabulary and stay in the denominator.
const EXCLUDED_LEXICAL_UPOS = new Set(['PROPN', 'NUM', 'PUNCT', 'SYM', 'X']);
// A 24-question initial diagnostic is intentionally too small to activate a
// 92–98% personal-coverage promise.  The hard gate is held back until each
// frequency band in the candidate article has a meaningful amount of direct
// evidence.  The threshold is about readiness to estimate, not a mastery bar.
const COVERAGE_GATE_MIN_DIRECT_EVIDENCE = 12;
const COVERAGE_GATE_MIN_CONFIDENCE = 0.6;
const WILSON_Z_95 = 1.96;
// This is an auditable material policy, not a claim about a specific reader's
// vocabulary size or an exam corpus. It stays active before the app has enough
// independent personal evidence to make an individual coverage estimate.
const CONSERVATIVE_MATERIAL_POLICY = Object.freeze({
  id: 'traceable-core-conservative-v1',
  minTraceableCoreCoverage: 0.9,
  minFoundationCoverage: 0.8,
  maxUpperFrequencyCoverage: 0.12,
  foundationBands: new Set(['ngsl-1', 'ngsl-2', 'ngsl-3'])
});

function cancellationError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('请求已取消');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancellationError(signal);
}

function isCancellation(error, signal) {
  return Boolean(signal?.aborted)
    || error?.name === 'AbortError'
    || error?.code === 'ABORT_ERR'
    || error?.code === 'ERR_CANCELED'
    || String(error?.message || '').trim() === '请求已取消';
}

/**
 * Builds an asynchronous quality gate for generated reading articles.
 *
 * It intentionally has no DB, UI, API-key, or generation dependencies.  The
 * app can inject its versioned lexicon, personal evidence repository and local
 * UDPipe worker at the composition root. A broken core/parser/profile is a
 * failed gate; unresolved tokens contribute zero known coverage, and an
 * uncalibrated reader uses a deliberately transparent conservative mode.
 */
export function createArticleQualityValidator({
  baseValidate = defaultBaseValidate,
  lexiconLoader = null,
  personalProfile = null,
  grammarAnalyzer = null,
  aiFallback = null,
  targetCoverage = null,
  calibrationStatus = null,
  personalization = null,
  minimumPersonalConfidence = 0.15
} = {}) {
  if (typeof baseValidate !== 'function') throw new TypeError('baseValidate 必须是函数');

  return async function validateGeneratedArticle(content, profile = {}, targetWords = [], options = {}) {
    throwIfAborted(options.signal);
    const base = await runBaseValidation(baseValidate, content, profile, targetWords, options.signal);
    throwIfAborted(options.signal);
    const resolvedProfile = base.profile || profile || {};
    const grammarInspection = await inspectGrammar(content, resolvedProfile, grammarAnalyzer, aiFallback, options);
    const { lexicalTokens, ...grammarReport } = grammarInspection;
    throwIfAborted(options.signal);
    const lexiconProfile = await inspectLexicon(content, lexiconLoader, options.signal, lexicalTokens);
    throwIfAborted(options.signal);
    const personalizationState = resolvePersonalization({
      invocation: options.personalization,
      configured: personalization,
      invocationCalibrationStatus: options.calibrationStatus,
      configuredCalibrationStatus: calibrationStatus,
      invocationTargetCoverage: options.targetCoverage,
      configuredTargetCoverage: targetCoverage,
      profile: resolvedProfile
    });
    const personalFit = await inspectPersonalFit({
      lexiconProfile,
      personalProfile,
      profile: resolvedProfile,
      personalization: personalizationState,
      minimumConfidence: normalizeMinimumConfidence(minimumPersonalConfidence),
      signal: options.signal
    });
    throwIfAborted(options.signal);

    const deviations = [
      ...(Array.isArray(base.deviations) ? base.deviations : []),
      ...lexiconProfile.deviations,
      ...grammarReport.deviations,
      ...personalFit.deviations
    ];

    return {
      passed: Boolean(base.passed) && lexiconProfile.status === 'available' && grammarReport.passed && personalFit.passed,
      metrics: {
        ...(isRecord(base.metrics) ? base.metrics : {}),
        lexicon: lexiconProfile.metrics,
        grammar: grammarReport.metrics || null,
        personalFit: personalFit.metrics || null
      },
      deviations,
      profile: resolvedProfile,
      lexiconProfile,
      grammarReport,
      personalFit
    };
  };
}

async function runBaseValidation(baseValidate, content, profile, targetWords, signal) {
  try {
    const result = await baseValidate(content, profile, targetWords);
    if (!isRecord(result)) {
      return {
        passed: false,
        metrics: {},
        deviations: [{ code: 'base_validation_unavailable', reason: 'INVALID_BASE_VALIDATION_RESULT' }],
        profile
      };
    }
    const hasMetrics = isRecord(result.metrics);
    const hasDeviations = Array.isArray(result.deviations);
    const complete = hasMetrics && hasDeviations;
    return {
      passed: complete && Boolean(result.passed),
      metrics: hasMetrics ? result.metrics : {},
      deviations: [
        ...(hasDeviations ? result.deviations : [{ code: 'base_validation_unavailable', reason: 'INVALID_BASE_VALIDATION_DEVIATIONS' }]),
        ...(!hasMetrics ? [{ code: 'base_validation_unavailable', reason: 'INVALID_BASE_VALIDATION_METRICS' }] : [])
      ],
      profile: result.profile || profile
    };
  } catch (error) {
    if (isCancellation(error, signal)) throw error;
    return {
      passed: false,
      metrics: {},
      deviations: [{ code: 'base_validation_unavailable', reason: 'BASE_VALIDATION_FAILED' }],
      profile
    };
  }
}

function tokenize(content) {
  return (String(content || '').match(WORD_PATTERN) || []).map(word => word.toLocaleLowerCase('en-US'));
}

function resolveLexiconTokens(content, lexicalTokens) {
  if (!Array.isArray(lexicalTokens)) {
    return {
      tokens: tokenize(content),
      tokenizationSource: 'surface_fallback'
    };
  }

  const tokens = [];
  for (const token of lexicalTokens) {
    const normalized = normalizeParsedLexicalToken(token);
    // A partial parser stream is not lexical evidence. Fall back for the whole
    // article rather than selectively accepting an unverifiable subset.
    if (!normalized) {
      return {
        tokens: tokenize(content),
        tokenizationSource: 'surface_fallback'
      };
    }
    if (!normalized.excluded) tokens.push(normalized.lemma);
  }
  return {
    tokens,
    tokenizationSource: 'local_udpipe_lemma'
  };
}

function normalizeParsedLexicalToken(token) {
  if (!isRecord(token)) return null;
  const form = typeof token.form === 'string' ? token.form.trim() : '';
  const lemma = typeof token.lemma === 'string' ? token.lemma.trim() : '';
  const upos = typeof token.upos === 'string' ? token.upos.trim().toUpperCase() : '';
  if (!form || !/^[A-Z]+$/.test(upos)) return null;
  if (EXCLUDED_LEXICAL_UPOS.has(upos)) return { excluded: true, lemma: null };
  if (!WORD_TOKEN_PATTERN.test(lemma)) return null;
  return {
    excluded: false,
    lemma: lemma.toLocaleLowerCase('en-US')
  };
}

async function inspectLexicon(content, loader, signal, lexicalTokens = null) {
  throwIfAborted(signal);
  const tokenization = resolveLexiconTokens(content, lexicalTokens);
  const tokens = tokenization.tokens;
  const empty = emptyLexiconProfile(tokens.length, tokenization.tokenizationSource);
  if (!loader || typeof loader.loadCore !== 'function' || typeof loader.lookup !== 'function') {
    return unavailableLexiconProfile(empty, 'LEXICON_LOADER_UNAVAILABLE');
  }

  let core;
  try {
    core = await loader.loadCore();
  } catch (error) {
    if (isCancellation(error, signal)) throw error;
    return unavailableLexiconProfile(empty, 'LEXICON_LOAD_FAILED');
  }
  throwIfAborted(signal);
  if (!isRecord(core) || !nonEmptyString(core.lexiconVersion) || !Number.isInteger(core.entryCount) || core.entryCount < 1) {
    return unavailableLexiconProfile(empty, 'LEXICON_CORE_INVALID');
  }
  if (!tokens.length) {
    return {
      ...empty,
      status: 'available',
      lexiconVersion: core.lexiconVersion,
      coreEntryCount: core.entryCount,
      deviations: [],
      observations: []
    };
  }

  const uniqueTokens = [...new Set(tokens)];
  const lookupFailures = new Set();
  const lookups = await Promise.all(uniqueTokens.map(async token => {
    try {
      return [token, await loader.lookup(token)];
    } catch (error) {
      if (isCancellation(error, signal)) throw error;
      lookupFailures.add(token);
      return [token, null];
    }
  }));
  throwIfAborted(signal);
  if (lookupFailures.size) {
    return unavailableLexiconProfile(empty, 'LEXICON_LOOKUP_FAILED', {
      lexiconVersion: core.lexiconVersion,
      coreEntryCount: core.entryCount
    });
  }
  const entries = new Map(lookups);
  const unknown = new Set();
  const unbanded = new Set();
  const unverified = new Set();
  const bands = new Map();
  const cefrLevels = new Map();
  const examFocusTracks = new Map();
  let academicTokenCount = 0;

  for (const token of tokens) {
    const entry = entries.get(token);
    if (!isVerifiedEntry(entry)) {
      if (entry === null) unknown.add(token);
      else unverified.add(token);
      continue;
    }
    if (getTrustedLayerValues(entry, 'academic').length) academicTokenCount += 1;
    for (const level of getTrustedLayerValues(entry, 'cefr').map(layer => String(layer?.level || '').trim()).filter(Boolean)) {
      cefrLevels.set(level, (cefrLevels.get(level) || 0) + 1);
    }
    for (const track of getTrustedLayerValues(entry, 'examFocus')
      .flatMap((layer) => Array.isArray(layer?.tracks) && layer.tracks.length
        ? layer.tracks
        : [layer?.track || layer?.trackId])
      .map(track => String(track || '').trim().toLocaleLowerCase('en-US'))
      .filter(Boolean)) {
      examFocusTracks.set(track, (examFocusTracks.get(track) || 0) + 1);
    }
    const band = getFrequencyBand(entry);
    if (!band) {
      unbanded.add(token);
      continue;
    }
    bands.set(band, (bands.get(band) || 0) + 1);
  }

  const knownLexiconTokenCount = [...bands.values()].reduce((total, count) => total + count, 0);
  const metrics = {
    tokenCount: tokens.length,
    tokenizationSource: tokenization.tokenizationSource,
    knownLexiconTokenCount,
    unknownTokenCount: countTokenOccurrences(tokens, unknown),
    unbandedTokenCount: countTokenOccurrences(tokens, unbanded),
    unverifiedTokenCount: countTokenOccurrences(tokens, unverified),
    bandTokenCounts: Object.fromEntries([...bands.entries()].sort(([left], [right]) => left.localeCompare(right))),
    academicTokenCount,
    academicCoveragePercent: tokens.length ? (academicTokenCount / tokens.length) * 100 : 0,
    cefrTokenCounts: Object.fromEntries([...cefrLevels.entries()].sort(([left], [right]) => left.localeCompare(right))),
    examFocusTokenCounts: Object.fromEntries([...examFocusTracks.entries()].sort(([left], [right]) => left.localeCompare(right)))
  };
  const profile = {
    // A successfully loaded, versioned core is usable even when it cannot
    // classify every token. Those unresolved tokens are explicitly assigned
    // zero expected mastery by the personal-fit calculation below.
    status: 'available',
    lexiconVersion: core.lexiconVersion,
    coreEntryCount: core.entryCount,
    ...metrics,
    // A small, deduplicated sample is useful for debugging a future lexicon
    // build, while no article text or model response is persisted here.
    unknownLemmas: [...unknown].slice(0, 20),
    unbandedLemmas: [...unbanded].slice(0, 20),
    unverifiedLemmas: [...unverified].slice(0, 20),
    metrics,
    deviations: [],
    observations: []
  };
  if (metrics.unknownTokenCount || metrics.unbandedTokenCount || metrics.unverifiedTokenCount) {
    profile.observations.push({
      code: 'lexicon_unresolved_tokens',
      unknownTokenCount: metrics.unknownTokenCount,
      unbandedTokenCount: metrics.unbandedTokenCount,
      unverifiedTokenCount: metrics.unverifiedTokenCount
    });
  }
  return profile;
}

function emptyLexiconProfile(tokenCount, tokenizationSource = 'surface_fallback') {
  const metrics = {
    tokenCount,
    tokenizationSource,
    knownLexiconTokenCount: 0,
    unknownTokenCount: 0,
    unbandedTokenCount: 0,
    unverifiedTokenCount: 0,
    bandTokenCounts: {},
    academicTokenCount: 0,
    academicCoveragePercent: 0,
    cefrTokenCounts: {},
    examFocusTokenCounts: {}
  };
  return {
    status: 'unavailable',
    lexiconVersion: null,
    coreEntryCount: 0,
    ...metrics,
    unknownLemmas: [],
    unbandedLemmas: [],
    unverifiedLemmas: [],
    metrics,
    deviations: []
  };
}

function unavailableLexiconProfile(profile, reason, details = {}) {
  return {
    ...profile,
    ...details,
    status: 'unavailable',
    deviations: [{ code: 'lexicon_coverage_unavailable', reason }]
  };
}

function isVerifiedEntry(entry) {
  return isRecord(entry)
    && nonEmptyString(entry.lemma)
    && Array.isArray(entry.sourceRefs)
    && entry.sourceRefs.some(nonEmptyString)
    && entry.quality !== 'rejected';
}

function getFrequencyBand(entry) {
  const values = getTrustedLayerValues(entry, 'frequency');
  for (const layer of values) {
    if (nonEmptyString(layer?.band)) return String(layer.band).trim().toLocaleLowerCase('en-US');
  }
  return null;
}

function getTrustedLayerValues(entry, layerName) {
  const values = Array.isArray(entry?.layers?.[layerName])
    ? entry.layers[layerName]
    : [entry?.layers?.[layerName]].filter(Boolean);
  const sourceRefs = new Set(
    Array.isArray(entry?.sourceRefs)
      ? entry.sourceRefs.filter(nonEmptyString).map(source => String(source).trim())
      : []
  );
  return values.filter(layer => {
    const sourceRef = nonEmptyString(layer?.sourceRef) ? String(layer.sourceRef).trim() : '';
    return Boolean(sourceRef && sourceRefs.has(sourceRef));
  });
}

function countTokenOccurrences(tokens, tokenSet) {
  return tokens.reduce((count, token) => count + (tokenSet.has(token) ? 1 : 0), 0);
}

async function inspectGrammar(content, profile, analyzer, fallback, options) {
  throwIfAborted(options?.signal);
  const local = await runLocalGrammarAnalyzer(content, analyzer, options?.signal);
  throwIfAborted(options?.signal);
  if (local.status === 'available') {
    return validateGrammarAnalysis(local, profile?.syntaxRange);
  }

  const localFailure = safeLocalFailure(local);
  if (typeof fallback !== 'function') {
    return {
      ...validateGrammarAnalysis(local, profile?.syntaxRange),
      localFailure
    };
  }

  let fallbackResult;
  try {
    fallbackResult = await fallback(String(content || ''), {
      profile,
      localFailure,
      signal: options?.signal
    });
    throwIfAborted(options?.signal);
  } catch (error) {
    if (isCancellation(error, options?.signal)) throw error;
    fallbackResult = { status: 'unavailable', source: 'ai_fallback', reason: 'AI_FALLBACK_FAILED', metrics: null };
  }
  const strictFallback = coerceStrictAiFallback(fallbackResult);
  return {
    ...validateGrammarAnalysis(strictFallback, profile?.syntaxRange),
    localFailure
  };
}

async function runLocalGrammarAnalyzer(content, analyzer, signal) {
  throwIfAborted(signal);
  if (!analyzer || typeof analyzer.analyze !== 'function') {
    return { status: 'unavailable', source: 'local', reason: 'GRAMMAR_ANALYZER_UNAVAILABLE', metrics: null };
  }
  try {
    const result = await analyzer.analyze(String(content || ''), { signal });
    if (result?.status === 'available') {
      // The local runtime cannot claim AI provenance. If it does, treat its
      // response as unavailable rather than allowing a source spoof.
      if (result.source !== 'local') {
        return { status: 'unavailable', source: 'local', reason: 'LOCAL_ANALYZER_INVALID_SOURCE', metrics: null };
      }
      return result;
    }
    if (result?.status === 'unavailable') {
      return {
        status: 'unavailable',
        source: 'local',
        reason: normalizeReason(result.reason, 'LOCAL_ANALYZER_UNAVAILABLE'),
        metrics: null
      };
    }
    return { status: 'unavailable', source: 'local', reason: 'LOCAL_ANALYZER_INVALID_RESULT', metrics: null };
  } catch (error) {
    if (isCancellation(error, signal)) throw error;
    return { status: 'unavailable', source: 'local', reason: 'LOCAL_ANALYZER_FAILED', metrics: null };
  }
}

function coerceStrictAiFallback(result) {
  if (!isRecord(result) || result.status !== 'available' || result.source !== 'ai_fallback' || !isRecord(result.metrics)) {
    return { status: 'unavailable', source: 'ai_fallback', reason: 'AI_FALLBACK_INVALID_RESPONSE', metrics: null };
  }
  return {
    status: 'available',
    source: 'ai_fallback',
    metrics: result.metrics
  };
}

function safeLocalFailure(result) {
  return {
    status: 'unavailable',
    source: 'local',
    reason: normalizeReason(result?.reason, 'LOCAL_ANALYZER_UNAVAILABLE')
  };
}

async function inspectPersonalFit({ lexiconProfile, personalProfile, personalization, minimumConfidence, signal }) {
  throwIfAborted(signal);
  if (personalization.mode === 'uncalibrated_conservative') {
    return inspectConservativeMaterialFit({
      lexiconProfile,
      personalization,
      status: 'uncalibrated_conservative'
    });
  }

  const collectingEvidence = personalization.mode === 'evidence_collecting';
  const targetCoverage = collectingEvidence ? personalization.recommendedCoverage : personalization.targetCoverage;
  const unavailable = reason => ({
    status: 'unavailable',
    passed: false,
    calibrationStatus: personalization.calibrationStatus,
    targetCoverage,
    estimatedCoverage: null,
    confidence: null,
    estimatedKnownTokenCount: 0,
    metrics: null,
    deviations: [{ code: 'personal_fit_unavailable', reason }]
  });

  if (lexiconProfile.status !== 'available') {
    if (collectingEvidence) {
      return inspectConservativeMaterialFit({
        lexiconProfile,
        personalization,
        status: 'evidence_collecting',
        reason: 'LEXICON_CORE_UNAVAILABLE'
      });
    }
    return unavailable('LEXICON_CORE_UNAVAILABLE');
  }
  const total = Number(lexiconProfile.metrics?.tokenCount);
  if (!Number.isFinite(total) || total < 0) {
    if (collectingEvidence) {
      return inspectConservativeMaterialFit({
        lexiconProfile,
        personalization,
        status: 'evidence_collecting',
        reason: 'LEXICON_METRICS_UNAVAILABLE'
      });
    }
    return unavailable('LEXICON_METRICS_UNAVAILABLE');
  }
  if (collectingEvidence) {
    return inspectEvidenceCollectingFit({
      lexiconProfile,
      personalProfile,
      personalization,
      targetCoverage,
      total,
      minimumConfidence,
      signal
    });
  }
  if (!Number.isFinite(targetCoverage)) {
    return inspectConservativeMaterialFit({
      lexiconProfile,
      personalization,
      status: 'uncalibrated_conservative',
      reason: 'TARGET_COVERAGE_UNAVAILABLE'
    });
  }

  const bandTokenCounts = lexiconProfile.metrics?.bandTokenCounts || {};
  const bands = Object.keys(bandTokenCounts);
  // An article with no classified token has a transparent lower-bound
  // coverage of zero. It is not an invented mastery estimate.
  if (!bands.length) {
    return createCalibratedPersonalFit({
      targetCoverage,
      total,
      expectedKnownTokenCount: 0,
      confidence: 0,
      minimumConfidence,
      bandEstimates: {},
      missingBands: []
    });
  }
  if (!personalProfile) return unavailable('PERSONAL_PROFILE_UNAVAILABLE');

  const profiles = await Promise.all(bands.map(async band => [band, await getBandProfile(personalProfile, band, signal)]));
  throwIfAborted(signal);
  const missingBands = [];
  let expectedKnownTokenCount = 0;
  let confidence = 1;
  const bandEstimates = {};
  for (const [band, bandProfile] of profiles) {
    const count = Number(bandTokenCounts[band]) || 0;
    if (!isUsableBandProfile(bandProfile)) {
      // Missing direct evidence contributes zero, never an assumed known
      // probability. A zero confidence keeps the report fail-closed.
      missingBands.push(band);
      confidence = 0;
      bandEstimates[band] = {
        tokenCount: count,
        masteryProbability: null,
        confidence: 0,
        directEvidenceCount: null
      };
      continue;
    }
    const probability = bandProfile.masteryProbability;
    expectedKnownTokenCount += count * probability;
    confidence = Math.min(confidence, bandProfile.confidence);
    bandEstimates[band] = {
      tokenCount: count,
      masteryProbability: probability,
      confidence: bandProfile.confidence,
      directEvidenceCount: Number.isFinite(bandProfile.directEvidenceCount) ? bandProfile.directEvidenceCount : null
    };
  }
  return createCalibratedPersonalFit({
    targetCoverage,
    total,
    expectedKnownTokenCount,
    confidence,
    minimumConfidence,
    bandEstimates,
    missingBands
  });
}

async function inspectEvidenceCollectingFit({
  lexiconProfile,
  personalProfile,
  personalization,
  targetCoverage,
  total,
  minimumConfidence,
  signal
}) {
  const bandTokenCounts = lexiconProfile.metrics?.bandTokenCounts || {};
  const bands = Object.keys(bandTokenCounts);
  if (!bands.length || !personalProfile || !Number.isFinite(targetCoverage)) {
    return inspectConservativeMaterialFit({
      lexiconProfile,
      personalization,
      status: 'evidence_collecting',
      reason: !bands.length ? 'NO_CLASSIFIED_BANDS' : !personalProfile ? 'PERSONAL_PROFILE_UNAVAILABLE' : 'RECOMMENDED_COVERAGE_UNAVAILABLE',
      collection: { tokenCount: total, missingBands: bands }
    });
  }

  const profiles = await Promise.all(bands.map(async band => [band, await getBandProfile(personalProfile, band, signal)]));
  throwIfAborted(signal);
  const gateEvidence = summarizeCoverageGateEvidence(profiles, bandTokenCounts);
  if (!gateEvidence.ready) {
    return inspectConservativeMaterialFit({
      lexiconProfile,
      personalization,
      status: 'evidence_collecting',
      reason: gateEvidence.reason,
      collection: {
        tokenCount: total,
        missingBands: gateEvidence.missingBands,
        insufficientBands: gateEvidence.insufficientBands,
        bandEstimates: gateEvidence.bandEstimates
      }
    });
  }

  return createCalibratedPersonalFit({
    targetCoverage,
    total,
    expectedKnownTokenCount: gateEvidence.expectedKnownTokenCount,
    confidence: gateEvidence.confidence,
    minimumConfidence,
    bandEstimates: gateEvidence.bandEstimates,
    missingBands: [],
    gateStatus: 'active',
    coverageMethod: 'wilson-lower-95'
  });
}

function summarizeCoverageGateEvidence(profiles, bandTokenCounts) {
  const missingBands = [];
  const insufficientBands = [];
  const bandEstimates = {};
  let expectedKnownTokenCount = 0;
  let confidence = 1;

  for (const [band, profile] of profiles) {
    const tokenCount = Number(bandTokenCounts[band]) || 0;
    const evidence = extractDirectBandEvidence(profile);
    if (!evidence) {
      missingBands.push(band);
      bandEstimates[band] = {
        tokenCount,
        masteryProbability: null,
        lowerBound95: null,
        confidence: 0,
        directEvidenceCount: null
      };
      continue;
    }

    const ready = evidence.directEvidenceCount >= COVERAGE_GATE_MIN_DIRECT_EVIDENCE
      && evidence.confidence >= COVERAGE_GATE_MIN_CONFIDENCE;
    if (!ready) insufficientBands.push(band);
    confidence = Math.min(confidence, evidence.confidence);
    expectedKnownTokenCount += tokenCount * evidence.lowerBound95;
    bandEstimates[band] = { tokenCount, ...evidence };
  }

  return {
    ready: missingBands.length === 0 && insufficientBands.length === 0,
    reason: missingBands.length ? 'MISSING_DIRECT_EVIDENCE' : insufficientBands.length ? 'INSUFFICIENT_INDEPENDENT_EVIDENCE' : '',
    missingBands,
    insufficientBands,
    expectedKnownTokenCount,
    confidence,
    bandEstimates
  };
}

function extractDirectBandEvidence(profile) {
  if (!isRecord(profile)) return null;
  const successCount = Number(profile.independentSuccessCount);
  const failureCount = Number(profile.independentFailureCount);
  if (!Number.isInteger(successCount) || successCount < 0 || !Number.isInteger(failureCount) || failureCount < 0) return null;
  const directEvidenceCount = successCount + failureCount;
  if (!directEvidenceCount) return null;
  return {
    masteryProbability: (successCount + 1) / (directEvidenceCount + 2),
    lowerBound95: wilsonLowerBound(successCount, directEvidenceCount),
    confidence: directEvidenceCount / (directEvidenceCount + 6),
    directEvidenceCount,
    independentEvidenceCount: directEvidenceCount
  };
}

function wilsonLowerBound(successCount, total) {
  if (!Number.isFinite(successCount) || !Number.isFinite(total) || total <= 0) return 0;
  const proportion = successCount / total;
  const zSquared = WILSON_Z_95 ** 2;
  const center = proportion + zSquared / (2 * total);
  const margin = WILSON_Z_95 * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * total)) / total);
  return Math.max(0, Math.min(1, (center - margin) / (1 + zSquared / total)));
}

function createCalibratedPersonalFit({
  targetCoverage,
  total,
  expectedKnownTokenCount,
  confidence,
  minimumConfidence,
  bandEstimates,
  missingBands,
  gateStatus = 'active',
  coverageMethod = 'posterior-mean'
}) {
  const estimatedCoverage = total > 0 ? (expectedKnownTokenCount / total) * 100 : 0;
  const deviations = [];
  if (estimatedCoverage < targetCoverage) {
    deviations.push({ code: 'personal_coverage', expected: { min: targetCoverage, max: 100 }, actual: estimatedCoverage });
  }
  if (confidence < minimumConfidence) {
    deviations.push({ code: 'personal_confidence', expected: { min: minimumConfidence, max: 1 }, actual: confidence });
  }
  return {
    status: 'available',
    passed: deviations.length === 0,
    targetCoverage,
    estimatedCoverage,
    confidence,
    estimatedKnownTokenCount: expectedKnownTokenCount,
    missingBands,
    gateStatus,
    coverageMethod,
    metrics: {
      tokenCount: total,
      expectedKnownTokenCount,
      estimatedCoverage,
      confidence,
      targetCoverage,
      gateStatus,
      coverageMethod,
      bandEstimates
    },
    deviations
  };
}

function inspectConservativeMaterialFit({
  lexiconProfile,
  personalization,
  status = 'uncalibrated_conservative',
  reason = 'CONSERVATIVE_MATERIAL_POLICY_APPLIED',
  collection = {}
} = {}) {
  const collectingEvidence = status === 'evidence_collecting';
  const metrics = isRecord(lexiconProfile?.metrics) ? lexiconProfile.metrics : null;
  const tokenCount = Number(metrics?.tokenCount);
  const knownCoreTokenCount = Number(metrics?.knownLexiconTokenCount);
  const bandTokenCounts = isRecord(metrics?.bandTokenCounts) ? metrics.bandTokenCounts : {};
  const foundationTokenCount = Object.entries(bandTokenCounts)
    .filter(([band]) => CONSERVATIVE_MATERIAL_POLICY.foundationBands.has(band))
    .reduce((total, [, count]) => total + (Number(count) || 0), 0);
  const upperFrequencyTokenCount = Object.entries(bandTokenCounts)
    .filter(([band]) => /^ngsl-[4-9]\d*$/u.test(band))
    .reduce((total, [, count]) => total + (Number(count) || 0), 0);
  const materialAvailable = lexiconProfile?.status === 'available'
    && Number.isFinite(tokenCount)
    && tokenCount > 0
    && Number.isFinite(knownCoreTokenCount);
  const traceableCoreCoverage = materialAvailable ? knownCoreTokenCount / tokenCount : null;
  const foundationCoverage = materialAvailable ? foundationTokenCount / tokenCount : null;
  const upperFrequencyCoverage = materialAvailable ? upperFrequencyTokenCount / tokenCount : null;
  const deviations = [];

  if (!materialAvailable) {
    deviations.push({ code: 'conservative_material_unavailable', reason });
  } else {
    if (traceableCoreCoverage < CONSERVATIVE_MATERIAL_POLICY.minTraceableCoreCoverage) {
      deviations.push({
        code: 'conservative_core_coverage',
        expected: { min: CONSERVATIVE_MATERIAL_POLICY.minTraceableCoreCoverage * 100, max: 100 },
        actual: traceableCoreCoverage * 100
      });
    }
    if (foundationCoverage < CONSERVATIVE_MATERIAL_POLICY.minFoundationCoverage) {
      deviations.push({
        code: 'conservative_foundation_coverage',
        expected: { min: CONSERVATIVE_MATERIAL_POLICY.minFoundationCoverage * 100, max: 100 },
        actual: foundationCoverage * 100
      });
    }
    if (upperFrequencyCoverage > CONSERVATIVE_MATERIAL_POLICY.maxUpperFrequencyCoverage) {
      deviations.push({
        code: 'conservative_upper_frequency_coverage',
        expected: { min: 0, max: CONSERVATIVE_MATERIAL_POLICY.maxUpperFrequencyCoverage * 100 },
        actual: upperFrequencyCoverage * 100
      });
    }
  }

  const materialMetrics = {
    policyId: CONSERVATIVE_MATERIAL_POLICY.id,
    tokenCount: Number.isFinite(tokenCount) ? tokenCount : null,
    knownCoreTokenCount: Number.isFinite(knownCoreTokenCount) ? knownCoreTokenCount : null,
    foundationTokenCount,
    upperFrequencyTokenCount,
    traceableCoreCoveragePercent: traceableCoreCoverage === null ? null : traceableCoreCoverage * 100,
    foundationCoveragePercent: foundationCoverage === null ? null : foundationCoverage * 100,
    upperFrequencyCoveragePercent: upperFrequencyCoverage === null ? null : upperFrequencyCoverage * 100,
    minTraceableCoreCoveragePercent: CONSERVATIVE_MATERIAL_POLICY.minTraceableCoreCoverage * 100,
    minFoundationCoveragePercent: CONSERVATIVE_MATERIAL_POLICY.minFoundationCoverage * 100,
    maxUpperFrequencyCoveragePercent: CONSERVATIVE_MATERIAL_POLICY.maxUpperFrequencyCoverage * 100,
    lexiconVersion: lexiconProfile?.lexiconVersion || null
  };
  const promptInstruction = collectingEvidence
    ? 'Use high-frequency core vocabulary and clear sentences while independent direct evidence is still being collected. Keep the material inside the traceable conservative-core policy; do not state or imply a personalized coverage percentage.'
    : 'Use high-frequency core vocabulary and short sentences. Keep the material inside the traceable conservative-core policy; do not state or imply a personalized coverage percentage for this uncalibrated reader.';

  return {
    status,
    passed: deviations.length === 0,
    calibrationStatus: personalization?.calibrationStatus,
    recommendedCoverage: collectingEvidence && Number.isFinite(personalization?.recommendedCoverage)
      ? personalization.recommendedCoverage
      : null,
    targetCoverage: null,
    estimatedCoverage: null,
    confidence: null,
    estimatedKnownTokenCount: null,
    missingBands: Array.isArray(collection.missingBands) ? collection.missingBands : [],
    insufficientBands: Array.isArray(collection.insufficientBands) ? collection.insufficientBands : [],
    gateStatus: collectingEvidence ? 'collecting' : 'conservative',
    coverageMethod: null,
    displayCoverage: false,
    requiresConservativePrompt: true,
    generationGuidance: {
      highFrequencyVocabulary: true,
      shortSentences: true,
      promptInstruction
    },
    metrics: {
      ...materialMetrics,
      recommendedCoverage: collectingEvidence && Number.isFinite(personalization?.recommendedCoverage)
        ? personalization.recommendedCoverage
        : null,
      bandEstimates: isRecord(collection.bandEstimates) ? collection.bandEstimates : {}
    },
    observations: [
      ...(collectingEvidence ? [{ code: 'personal_fit_collecting', reason }] : []),
      { code: 'conservative_material_policy', policyId: CONSERVATIVE_MATERIAL_POLICY.id }
    ],
    deviations
  };
}

async function getBandProfile(profile, band, signal) {
  try {
    if (typeof profile?.getBandProfile === 'function') return await profile.getBandProfile(band);
    if (typeof profile?.getKnowledgeBand === 'function') return await profile.getKnowledgeBand(band);
    if (typeof profile?.getBandProfiles === 'function') {
      const values = await profile.getBandProfiles([band]);
      if (values instanceof Map) return values.get(band) || null;
      return values?.[band] || null;
    }
    if (isRecord(profile?.bands)) return profile.bands[band] || null;
  } catch (error) {
    if (isCancellation(error, signal)) throw error;
    return null;
  }
  return null;
}

function isUsableBandProfile(profile) {
  return isRecord(profile)
    && Number.isFinite(profile.masteryProbability)
    && profile.masteryProbability >= 0
    && profile.masteryProbability <= 1
    && Number.isFinite(profile.confidence)
    && profile.confidence >= 0
    && profile.confidence <= 1;
}

function resolvePersonalization({
  invocation,
  configured,
  invocationCalibrationStatus,
  configuredCalibrationStatus,
  invocationTargetCoverage,
  configuredTargetCoverage,
  profile
} = {}) {
  const invocationConfig = isRecord(invocation) ? invocation : {};
  const configuredProfile = isRecord(configured) ? configured : {};
  const rawStatus = firstNonEmpty(
    typeof invocation === 'string' ? invocation : null,
    invocationConfig.calibrationStatus,
    invocationConfig.status,
    invocationCalibrationStatus,
    typeof configured === 'string' ? configured : null,
    configuredProfile.calibrationStatus,
    configuredProfile.status,
    configuredCalibrationStatus
  );
  const normalizedStatus = normalizeCalibrationStatus(rawStatus);
  const reportedStatus = rawStatus ? String(rawStatus).trim().toLocaleLowerCase('en-US') : 'new';
  const requestedMode = firstNonEmpty(invocationConfig.mode, configuredProfile.mode);
  const targetCoverage = resolveTargetCoverage(
    invocationConfig.targetCoverage,
    invocationTargetCoverage,
    configuredProfile.targetCoverage,
    configuredTargetCoverage,
    profile?.coverage,
    profile?.coverageRange?.min
  );
  const recommendedCoverage = resolveTargetCoverage(
    invocationConfig.recommendedCoverage,
    configuredProfile.recommendedCoverage,
    targetCoverage
  );
  if (normalizedStatus !== 'calibrated') {
    return {
      mode: 'uncalibrated_conservative',
      calibrationStatus: reportedStatus,
      targetCoverage: null
    };
  }
  if (String(requestedMode || '').trim() === 'evidence_collecting') {
    return {
      mode: 'evidence_collecting',
      calibrationStatus: reportedStatus,
      targetCoverage: null,
      recommendedCoverage
    };
  }
  if (!Number.isFinite(targetCoverage)) {
    return {
      mode: 'uncalibrated_conservative',
      calibrationStatus: reportedStatus,
      targetCoverage: null
    };
  }
  return {
    mode: 'evidence_calibrated',
    calibrationStatus: reportedStatus,
    targetCoverage
  };
}

function normalizeCalibrationStatus(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US') === 'calibrated'
    ? 'calibrated'
    : 'uncalibrated';
}

function firstNonEmpty(...values) {
  return values.find(value => value !== null && value !== undefined && String(value).trim() !== '') || null;
}

function resolveTargetCoverage(...values) {
  for (const value of values) {
    if (value === null || value === undefined || String(value).trim() === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 100) return numeric;
  }
  return null;
}

function normalizeMinimumConfidence(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.15;
}

function normalizeReason(value, fallback) {
  const normalized = String(value || '').trim().toUpperCase();
  return SAFE_REASON.test(normalized) ? normalized : fallback;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
