/**
 * Compare metrics emitted by a real dependency parser with a selected syntax
 * profile.  This module deliberately never inspects article text: a missing
 * parser result must remain a failure instead of becoming a rule-based guess.
 */

const REQUIRED_METRICS = [
  'tokenCount',
  'sentenceCount',
  'clauseRelationCount',
  'passivePredicateCount',
  'nonFiniteRelationCount',
  'maxDependencyDepth'
];

const PROFILE_FIELDS = [
  ['dependencyDepth', 'maxDependencyDepth', 'dependency_depth'],
  ['subordinateRate', 'subordinateRate', 'subordinate_rate'],
  ['passiveRate', 'passiveRate', 'passive_rate'],
  ['nonFiniteRate', 'nonFiniteRate', 'non_finite_rate']
];

export function validateGrammarAnalysis(analysis, syntaxRange) {
  const validation = resolveSyntaxValidation(syntaxRange);
  if (analysis?.status !== 'available' || !analysis?.metrics) {
    return unavailableResult(analysis, validation);
  }

  const source = normalizeSource(analysis.source);
  const raw = analysis.metrics;
  if (!hasCompleteMetrics(raw) || !hasSyntaxRanges(syntaxRange)) {
    return {
      passed: false,
      status: 'unavailable',
      enforcement: validation.enforcement,
      validation,
      source,
      metrics: null,
      deviations: [{
        code: 'grammar_metrics',
        reason: 'INCOMPLETE_OR_INVALID_PARSER_METRICS',
        source
      }]
    };
  }

  const metrics = {
    tokenCount: raw.tokenCount,
    sentenceCount: raw.sentenceCount,
    clauseRelationCount: raw.clauseRelationCount,
    passivePredicateCount: raw.passivePredicateCount,
    nonFiniteRelationCount: raw.nonFiniteRelationCount,
    maxDependencyDepth: raw.maxDependencyDepth,
    // Rates have explicit denominators so an audit can reproduce every value.
    subordinateRate: raw.clauseRelationCount / raw.tokenCount,
    passiveRate: raw.passivePredicateCount / raw.sentenceCount,
    // Non-finite relations are normalized by tokens, like subordinate
    // relations. A long sentence can contain more than one such relation.
    nonFiniteRate: raw.nonFiniteRelationCount / raw.tokenCount
  };

  const rawDeviations = PROFILE_FIELDS.flatMap(([profileField, metricField, code]) => {
    const range = syntaxRange[profileField];
    const value = metrics[metricField];
    if (value >= range.min && value <= range.max) return [];
    return [{
      code,
      value,
      expected: { min: range.min, max: range.max },
      source
    }];
  });

  const observesOnly = validation.enforcement === 'observe';
  const deviations = rawDeviations.map(deviation => ({
    ...deviation,
    severity: observesOnly ? 'observation' : 'failure'
  }));

  const result = {
    passed: observesOnly || deviations.length === 0,
    status: deviations.length === 0 ? 'available' : (observesOnly ? 'observed' : 'failed'),
    enforcement: validation.enforcement,
    validation,
    source,
    metrics,
    deviations
  };
  // Only the verified local parser is allowed to contribute lemma/POS evidence
  // to downstream lexical coverage. AI fallback keeps grammar metrics only.
  if (source === 'local' && Array.isArray(analysis.lexicalTokens)) {
    result.lexicalTokens = analysis.lexicalTokens;
  }
  return result;
}

function unavailableResult(analysis, validation) {
  const source = normalizeSource(analysis?.source);
  return {
    passed: false,
    status: 'unavailable',
    enforcement: validation.enforcement,
    validation,
    source,
    metrics: null,
    deviations: [{
      code: 'grammar_unavailable',
      reason: normalizeReason(analysis?.reason),
      source
    }]
  };
}

/**
 * Old callers pass a plain range and retain fail-closed enforcement. New
 * profiles can carry the provenance metadata needed to mark a temporary
 * strategy range as observation-only. A malformed marker never weakens a
 * gate: only the exact provisional contract can opt into observations.
 */
function resolveSyntaxValidation(syntaxRange) {
  const candidate = syntaxRange?.validation;
  if (isProvisionalObservationContract(candidate)) {
    return {
      schemaVersion: 1,
      status: 'provisional',
      enforcement: 'observe',
      registryId: candidate.registryId,
      registryVersion: candidate.registryVersion,
      reason: candidate.reason,
      metricSchema: candidate.metricSchema || null,
      track: candidate.track || null,
      challenge: candidate.challenge || null
    };
  }
  if (candidate?.status === 'active' && candidate?.enforcement === 'required') {
    return {
      schemaVersion: 1,
      status: 'active',
      enforcement: 'required',
      baselineId: normalizeMetadata(candidate.baselineId),
      baselineVersion: normalizeMetadata(candidate.baselineVersion),
      metricSchema: normalizeMetadata(candidate.metricSchema),
      track: normalizeMetadata(candidate.track),
      challenge: normalizeMetadata(candidate.challenge)
    };
  }
  return {
    schemaVersion: 1,
    status: candidate ? 'invalid' : 'legacy-unannotated',
    enforcement: 'required',
    reason: candidate ? 'INVALID_SYNTAX_VALIDATION_METADATA' : 'SYNTAX_VALIDATION_METADATA_MISSING'
  };
}

function isProvisionalObservationContract(candidate) {
  return candidate?.status === 'provisional'
    && candidate?.enforcement === 'observe'
    && normalizeMetadata(candidate.registryId) === 'track-baseline-registry'
    && Boolean(normalizeMetadata(candidate.registryVersion))
    && candidate?.reason === 'CORPUS_BASELINE_NOT_ACTIVATED';
}

function normalizeMetadata(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function hasCompleteMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return false;
  if (!REQUIRED_METRICS.every(field => Number.isFinite(metrics[field]) && metrics[field] >= 0)) return false;
  return metrics.tokenCount > 0
    && metrics.sentenceCount > 0
    && Number.isInteger(metrics.tokenCount)
    && Number.isInteger(metrics.sentenceCount)
    && Number.isInteger(metrics.clauseRelationCount)
    && Number.isInteger(metrics.passivePredicateCount)
    && Number.isInteger(metrics.nonFiniteRelationCount)
    && Number.isInteger(metrics.maxDependencyDepth);
}

function hasSyntaxRanges(syntaxRange) {
  if (!syntaxRange || typeof syntaxRange !== 'object') return false;
  return PROFILE_FIELDS.every(([field]) => {
    const range = syntaxRange[field];
    return Number.isFinite(range?.min) && Number.isFinite(range?.max) && range.min <= range.max;
  });
}

function normalizeSource(source) {
  return source === 'ai_fallback' ? 'ai_fallback' : 'local';
}

function normalizeReason(reason) {
  const value = String(reason || 'GRAMMAR_ANALYSIS_UNAVAILABLE').trim().toUpperCase();
  return /^[A-Z0-9_:-]+$/.test(value) ? value : 'GRAMMAR_ANALYSIS_UNAVAILABLE';
}
