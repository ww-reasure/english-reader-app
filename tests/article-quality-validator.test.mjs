import assert from 'node:assert/strict';
import test from 'node:test';

import { createArticleQualityValidator } from '../src/article-quality-validator.mjs';

const syntaxRange = {
  dependencyDepth: { min: 2, max: 5 },
  subordinateRate: { min: 0, max: 0.5 },
  passiveRate: { min: 0, max: 0.5 },
  nonFiniteRate: { min: 0, max: 0.5 }
};

const grammarMetrics = (overrides = {}) => ({
  tokenCount: 2,
  sentenceCount: 1,
  clauseRelationCount: 0,
  passivePredicateCount: 0,
  nonFiniteRelationCount: 0,
  maxDependencyDepth: 2,
  ...overrides
});

function createProfile() {
  return {
    track: 'cet4',
    challenge: 'standard',
    coverageRange: { min: 95, max: 97 },
    syntaxRange
  };
}

function createBaseValidator() {
  return (content, profile) => ({
    passed: true,
    metrics: { wordCount: String(content).trim().split(/\s+/).length, sentenceCount: 1, averageSentenceLength: 2 },
    deviations: [],
    profile
  });
}

function createLexicon(entries = {}) {
  const normalized = new Map(Object.entries(entries).map(([word, entry]) => [word.toLowerCase(), entry]));
  return {
    async loadCore() {
      return { lexiconVersion: 'test-lexicon-1', entryCount: normalized.size };
    },
    async lookup(word) {
      return normalized.get(String(word).toLowerCase()) || null;
    }
  };
}

function frequencyEntry(lemma, band = 'ngsl-1') {
  return {
    lemma,
    quality: 'high',
    layers: { frequency: [{ band, sourceRef: 'test-frequency' }] },
    sourceRefs: ['test-frequency']
  };
}

function createPersonalProfile({ masteryProbability = 0.98, confidence = 0.8 } = {}) {
  return {
    async getBandProfile() {
      return { masteryProbability, confidence, directEvidenceCount: 10 };
    }
  };
}

function createGrammarAnalyzer(result) {
  return { async analyze() { return result; } };
}

test('combines base, traceable lexicon, personal evidence and local dependency metrics', async () => {
  const fallbackCalls = [];
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable'), analysis: frequencyEntry('analysis') }),
    personalProfile: createPersonalProfile(),
    grammarAnalyzer: createGrammarAnalyzer({ status: 'available', source: 'local', metrics: grammarMetrics() }),
    calibrationStatus: 'calibrated',
    aiFallback: async (text, value) => { fallbackCalls.push({ text, value }); return null; }
  });

  const result = await validate('Stable analysis.', createProfile());

  assert.equal(result.passed, true);
  assert.equal(result.metrics.wordCount, 2);
  assert.equal(result.lexiconProfile.status, 'available');
  assert.equal(result.lexiconProfile.unknownTokenCount, 0);
  assert.equal(result.personalFit.status, 'available');
  assert.equal(result.personalFit.targetCoverage, 95);
  assert.equal(result.grammarReport.source, 'local');
  assert.equal(result.grammarReport.passed, true);
  assert.deepEqual(fallbackCalls, []);
});

test('forwards a generation cancellation signal into the local grammar analyzer', async () => {
  const controller = new AbortController();
  let receivedOptions = null;
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable'), analysis: frequencyEntry('analysis') }),
    personalProfile: createPersonalProfile(),
    grammarAnalyzer: {
      async analyze(_content, options) {
        receivedOptions = options;
        return { status: 'available', source: 'local', metrics: grammarMetrics() };
      }
    },
    calibrationStatus: 'calibrated'
  });

  await validate('Stable analysis.', createProfile(), [], { signal: controller.signal });

  assert.equal(receivedOptions?.signal, controller.signal);
});

test('uses locally parsed lemmas for lexical coverage and excludes proper names from the personal-coverage denominator', async () => {
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({
      student: frequencyEntry('student'),
      meet: frequencyEntry('meet')
    }),
    personalProfile: createPersonalProfile(),
    grammarAnalyzer: {
      async analyze() {
        return {
          status: 'available',
          source: 'local',
          metrics: grammarMetrics({ tokenCount: 3 }),
          lexicalTokens: [
            { form: 'Students', lemma: 'student', upos: 'NOUN' },
            { form: 'met', lemma: 'meet', upos: 'VERB' },
            { form: 'Alice', lemma: 'Alice', upos: 'PROPN' }
          ]
        };
      }
    },
    calibrationStatus: 'calibrated'
  });

  const result = await validate('Students met Alice.', createProfile());

  assert.equal(result.lexiconProfile.tokenizationSource, 'local_udpipe_lemma');
  assert.equal(result.lexiconProfile.tokenCount, 2);
  assert.equal(result.lexiconProfile.unknownTokenCount, 0);
  assert.deepEqual(result.lexiconProfile.bandTokenCounts, { 'ngsl-1': 2 });
  assert.equal(result.grammarReport.lexicalTokens, undefined);
});

test('uses a strict AI grammar result only after the local analyzer is unavailable', async () => {
  const fallbackCalls = [];
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable'), analysis: frequencyEntry('analysis') }),
    personalProfile: createPersonalProfile(),
    grammarAnalyzer: createGrammarAnalyzer({ status: 'unavailable', source: 'local', reason: 'MODEL_LOAD_FAILED', metrics: null }),
    calibrationStatus: 'calibrated',
    aiFallback: async (text, input) => {
      fallbackCalls.push({ text, input });
      return { status: 'available', source: 'ai_fallback', metrics: grammarMetrics() };
    }
  });

  const result = await validate('Stable analysis.', createProfile());

  assert.equal(result.passed, true);
  assert.equal(fallbackCalls.length, 1);
  assert.equal(fallbackCalls[0].text, 'Stable analysis.');
  assert.equal(fallbackCalls[0].input.localFailure.reason, 'MODEL_LOAD_FAILED');
  assert.equal(result.grammarReport.source, 'ai_fallback');
  assert.equal(result.grammarReport.localFailure.reason, 'MODEL_LOAD_FAILED');
});

test('does not call AI fallback when a local parser responds but its metrics are incomplete', async () => {
  let fallbackCalls = 0;
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable'), analysis: frequencyEntry('analysis') }),
    personalProfile: createPersonalProfile(),
    grammarAnalyzer: createGrammarAnalyzer({ status: 'available', source: 'local', metrics: { tokenCount: 2 } }),
    calibrationStatus: 'calibrated',
    aiFallback: async () => { fallbackCalls += 1; return { status: 'available', source: 'ai_fallback', metrics: grammarMetrics() }; }
  });

  const result = await validate('Stable analysis.', createProfile());

  assert.equal(result.passed, false);
  assert.equal(fallbackCalls, 0);
  assert.equal(result.grammarReport.passed, false);
  assert.ok(result.deviations.some(item => item.code === 'grammar_metrics'));
});

test('rejects a malformed AI fallback instead of treating it as grammar evidence', async () => {
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable'), analysis: frequencyEntry('analysis') }),
    personalProfile: createPersonalProfile(),
    grammarAnalyzer: createGrammarAnalyzer({ status: 'unavailable', source: 'local', reason: 'MODEL_LOAD_FAILED', metrics: null }),
    calibrationStatus: 'calibrated',
    aiFallback: async () => ({ status: 'available', source: 'ai_fallback', metrics: { tokenCount: 2 } })
  });

  const result = await validate('Stable analysis.', createProfile());

  assert.equal(result.passed, false);
  assert.equal(result.grammarReport.passed, false);
  assert.ok(result.deviations.some(item => item.code === 'grammar_metrics'));
});

test('a one-entry core never invents mastery for an unknown article word', async () => {
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    // This mirrors the currently admitted core: the entry has no active
    // frequency layer, and the other content token is not in the core at all.
    lexiconLoader: createLexicon({ abandon: { lemma: 'abandon', quality: 'limited', layers: {}, sourceRefs: ['oewn'] } }),
    personalProfile: createPersonalProfile(),
    grammarAnalyzer: createGrammarAnalyzer({ status: 'available', source: 'local', metrics: grammarMetrics() }),
    calibrationStatus: 'calibrated'
  });

  const result = await validate('Abandon mystery.', createProfile());

  assert.equal(result.passed, false);
  assert.equal(result.lexiconProfile.status, 'available');
  assert.equal(result.lexiconProfile.unknownTokenCount, 1);
  assert.equal(result.lexiconProfile.unbandedTokenCount, 1);
  assert.equal(result.personalFit.status, 'available');
  assert.equal(result.personalFit.estimatedKnownTokenCount, 0);
  assert.equal(result.personalFit.estimatedCoverage, 0);
  assert.ok(result.deviations.some(item => item.code === 'personal_coverage'));
});

test('does not use a frequency band whose source is not declared by its entry', async () => {
  const untrustedEntry = lemma => ({
    lemma,
    quality: 'limited',
    sourceRefs: ['oewn'],
    layers: { frequency: [{ band: 'ngsl-1', sourceRef: 'undeclared-frequency-source' }] }
  });
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: untrustedEntry('stable'), analysis: untrustedEntry('analysis') }),
    personalProfile: createPersonalProfile(),
    grammarAnalyzer: createGrammarAnalyzer({ status: 'available', source: 'local', metrics: grammarMetrics() }),
    calibrationStatus: 'calibrated'
  });

  const result = await validate('Stable analysis.', createProfile());

  assert.equal(result.passed, false);
  assert.equal(result.lexiconProfile.status, 'available');
  assert.equal(result.lexiconProfile.unbandedTokenCount, 2);
  assert.equal(result.personalFit.status, 'available');
  assert.equal(result.personalFit.estimatedKnownTokenCount, 0);
});

test('reports only source-declared academic, CEFR, and target-focus layers without inventing an exam constraint', async () => {
  const layeredEntry = lemma => ({
    lemma,
    quality: 'limited',
    sourceRefs: ['test-frequency', 'test-academic', 'test-cefr', 'test-focus'],
    layers: {
      frequency: [{ band: 'ngsl-2', sourceRef: 'test-frequency' }],
      academic: [{ membership: 'nawl-1.2', sourceRef: 'test-academic' }],
      cefr: [{ level: 'B2', sourceRef: 'test-cefr' }],
      examFocus: [{ tracks: ['cet4', 'cet6'], sourceRef: 'test-focus' }]
    }
  });
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: layeredEntry('stable'), analysis: layeredEntry('analysis') }),
    personalProfile: createPersonalProfile(),
    grammarAnalyzer: createGrammarAnalyzer({ status: 'available', source: 'local', metrics: grammarMetrics() }),
    calibrationStatus: 'calibrated'
  });

  const result = await validate('Stable analysis.', createProfile());

  assert.equal(result.passed, true);
  assert.equal(result.lexiconProfile.academicTokenCount, 2);
  assert.deepEqual(result.lexiconProfile.cefrTokenCounts, { B2: 2 });
  assert.deepEqual(result.lexiconProfile.examFocusTokenCounts, { cet4: 2, cet6: 2 });
  assert.deepEqual(result.lexiconProfile.metrics.cefrTokenCounts, { B2: 2 });
  assert.ok(!result.deviations.some(item => item.code === 'exam_focus_coverage'));
});

test('fails closed when an injected base validator claims success without a complete report', async () => {
  const validate = createArticleQualityValidator({
    baseValidate: () => ({ passed: true, metrics: { wordCount: 2 }, profile: createProfile() }),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable'), analysis: frequencyEntry('analysis') }),
    personalProfile: createPersonalProfile(),
    grammarAnalyzer: createGrammarAnalyzer({ status: 'available', source: 'local', metrics: grammarMetrics() }),
    calibrationStatus: 'calibrated'
  });

  const result = await validate('Stable analysis.', createProfile());

  assert.equal(result.passed, false);
  assert.ok(result.deviations.some(item => item.code === 'base_validation_unavailable'));
});

test('keeps an uncalibrated reader in transparent conservative mode without a coverage promise', async () => {
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable'), analysis: frequencyEntry('analysis') }),
    grammarAnalyzer: createGrammarAnalyzer({ status: 'available', source: 'local', metrics: grammarMetrics() }),
    calibrationStatus: 'skipped'
  });

  const result = await validate('Stable analysis.', createProfile());

  assert.equal(result.passed, true);
  assert.equal(result.personalFit.status, 'uncalibrated_conservative');
  assert.equal(result.personalFit.targetCoverage, null);
  assert.equal(result.personalFit.estimatedCoverage, null);
  assert.equal(result.personalFit.requiresConservativePrompt, true);
  assert.match(result.personalFit.generationGuidance.promptInstruction, /high-frequency/i);
  assert.match(result.personalFit.generationGuidance.promptInstruction, /short sentences/i);
});

test('rejects uncalibrated material when traceable foundation-core coverage is too low', async () => {
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable', 'ngsl-1') }),
    grammarAnalyzer: createGrammarAnalyzer({ status: 'available', source: 'local', metrics: grammarMetrics() }),
    calibrationStatus: 'skipped'
  });

  const result = await validate('Stable opaque opaque.', createProfile());

  assert.equal(result.passed, false);
  assert.equal(result.personalFit.status, 'uncalibrated_conservative');
  assert.equal(result.personalFit.displayCoverage, false);
  assert.ok(result.deviations.some(item => item.code === 'conservative_core_coverage'));
  assert.ok(result.deviations.some(item => item.code === 'conservative_foundation_coverage'));
});

test('keeps a completed first calibration in evidence collection instead of rejecting an article on a 95 percent coverage claim', async () => {
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable'), analysis: frequencyEntry('analysis') }),
    personalProfile: {
      async getBandProfile() {
        return { successCount: 1, failureCount: 0, directEvidenceCount: 1, masteryProbability: 2 / 3, confidence: 1 / 7 };
      }
    },
    grammarAnalyzer: createGrammarAnalyzer({ status: 'available', source: 'local', metrics: grammarMetrics() }),
    personalization: {
      mode: 'evidence_collecting',
      calibrationStatus: 'calibrated',
      recommendedCoverage: 95
    }
  });

  const result = await validate('Stable analysis.', createProfile());

  assert.equal(result.passed, true);
  assert.equal(result.personalFit.status, 'evidence_collecting');
  assert.equal(result.personalFit.targetCoverage, null);
  assert.equal(result.personalFit.recommendedCoverage, 95);
  assert.equal(result.personalFit.gateStatus, 'collecting');
  assert.ok(!result.deviations.some(item => item.code === 'personal_coverage'));
});

test('activates the hard coverage gate only when every article band has substantial direct evidence', async () => {
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable'), analysis: frequencyEntry('analysis') }),
    personalProfile: {
      async getBandProfile() {
        return {
          successCount: 100,
          failureCount: 0,
          independentSuccessCount: 100,
          independentFailureCount: 0,
          independentDirectEvidenceCount: 100,
          independentMasteryProbability: 101 / 102,
          independentConfidence: 100 / 106
        };
      }
    },
    grammarAnalyzer: createGrammarAnalyzer({ status: 'available', source: 'local', metrics: grammarMetrics() }),
    personalization: {
      mode: 'evidence_collecting',
      calibrationStatus: 'calibrated',
      recommendedCoverage: 95
    }
  });

  const result = await validate('Stable analysis.', createProfile());

  assert.equal(result.personalFit.status, 'available');
  assert.equal(result.personalFit.gateStatus, 'active');
  assert.equal(result.personalFit.targetCoverage, 95);
  assert.equal(result.personalFit.coverageMethod, 'wilson-lower-95');
  assert.equal(result.passed, true);
});

test('does not activate the hard coverage gate from repeated non-independent direct evidence', async () => {
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable'), analysis: frequencyEntry('analysis') }),
    personalProfile: {
      async getBandProfile() {
        return {
          successCount: 100,
          failureCount: 0,
          independentSuccessCount: 1,
          independentFailureCount: 0,
          independentDirectEvidenceCount: 1,
          independentMasteryProbability: 2 / 3,
          independentConfidence: 1 / 7
        };
      }
    },
    grammarAnalyzer: createGrammarAnalyzer({ status: 'available', source: 'local', metrics: grammarMetrics() }),
    personalization: {
      mode: 'evidence_collecting',
      calibrationStatus: 'calibrated',
      recommendedCoverage: 95
    }
  });

  const result = await validate('Stable analysis.', createProfile());

  assert.equal(result.passed, true);
  assert.equal(result.personalFit.status, 'evidence_collecting');
  assert.equal(result.personalFit.gateStatus, 'collecting');
  assert.ok(result.personalFit.insufficientBands.includes('ngsl-1'));
});

test('counts a small number of unknown words as zero mastery while allowing calibrated coverage to pass', async () => {
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable') }),
    personalProfile: createPersonalProfile({ masteryProbability: 0.98, confidence: 0.8 }),
    grammarAnalyzer: createGrammarAnalyzer({ status: 'available', source: 'local', metrics: grammarMetrics({ tokenCount: 100 }) }),
    calibrationStatus: 'calibrated'
  });
  const content = [...Array(98).fill('stable'), 'mystery', 'mystery'].join(' ');

  const result = await validate(content, createProfile());

  assert.equal(result.passed, true);
  assert.equal(result.lexiconProfile.status, 'available');
  assert.equal(result.lexiconProfile.unknownTokenCount, 2);
  assert.equal(result.personalFit.status, 'available');
  assert.ok(Math.abs(result.personalFit.estimatedCoverage - 96.04) < 0.000001);
  assert.ok(Math.abs(result.personalFit.estimatedKnownTokenCount - 96.04) < 0.000001);
});

test('propagates cancellation from an AI grammar fallback instead of turning it into a retryable validation error', async () => {
  const controller = new AbortController();
  const cancellation = new Error('user-cancelled');
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable'), analysis: frequencyEntry('analysis') }),
    personalProfile: createPersonalProfile(),
    grammarAnalyzer: createGrammarAnalyzer({ status: 'unavailable', source: 'local', reason: 'MODEL_LOAD_FAILED', metrics: null }),
    calibrationStatus: 'calibrated',
    aiFallback: async () => {
      controller.abort(cancellation);
      throw cancellation;
    }
  });

  await assert.rejects(
    validate('Stable analysis.', createProfile(), [], { signal: controller.signal }),
    /user-cancelled/
  );
});

test('propagates the app cancellation error even when the fallback exits before its signal changes', async () => {
  const validate = createArticleQualityValidator({
    baseValidate: createBaseValidator(),
    lexiconLoader: createLexicon({ stable: frequencyEntry('stable'), analysis: frequencyEntry('analysis') }),
    personalProfile: createPersonalProfile(),
    grammarAnalyzer: createGrammarAnalyzer({ status: 'unavailable', source: 'local', reason: 'MODEL_LOAD_FAILED', metrics: null }),
    calibrationStatus: 'calibrated',
    aiFallback: async () => { throw new Error('请求已取消'); }
  });

  await assert.rejects(
    validate('Stable analysis.', createProfile()),
    /请求已取消/
  );
});
