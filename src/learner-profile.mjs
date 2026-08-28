import { getDifficultyProfile } from './difficulty-profile.mjs';
import { normalizeSelectableTrack, getTrackLabel } from './learning-track.mjs';
import { buildReadingPersonalization } from './reading-personalization.mjs';

const MAX_BANDS = 12;
const MAX_COUNT = 100000;
const CALIBRATION_STATUSES = new Set(['new', 'skipped', 'calibrated', 'legacy']);
const FEEDBACK_VALUES = new Set(['too_hard', 'fitting', 'too_easy']);

const finiteNumber = value => Number.isFinite(Number(value)) ? Number(value) : null;
const nonNegativeCount = (value, maximum = MAX_COUNT) => Math.min(maximum, Math.max(0, Math.trunc(Number(value) || 0)));
const boundedProbability = value => {
  const number = finiteNumber(value);
  return number !== null && number >= 0 && number <= 1
    ? Math.round(number * 1000) / 1000
    : null;
};
const text = (value, limit = 120) => String(value || '').trim().slice(0, limit);

function normalizeCalibrationStatus(value) {
  const status = text(value, 32).toLocaleLowerCase('en-US');
  return CALIBRATION_STATUSES.has(status) ? status : 'new';
}

function calibrationStage(status) {
  return {
    new: 'not_started',
    skipped: 'deferred',
    calibrated: 'completed',
    legacy: 'legacy_unverified'
  }[status] || 'not_started';
}

function parseAssessmentProfile(value) {
  let source = value;
  if (typeof value === 'string') {
    try { source = JSON.parse(value); } catch { source = null; }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;

  const reading = source.readingComprehension && typeof source.readingComprehension === 'object'
    ? source.readingComprehension
    : null;
  const wordAccuracy = finiteNumber(source.wordAccuracy ?? source.readingProfile?.wordAccuracy);
  const correct = reading ? nonNegativeCount(reading.correct, 100) : null;
  const total = reading ? nonNegativeCount(reading.total, 100) : null;
  if (wordAccuracy === null && (!reading || total === null)) return null;

  return {
    ...(wordAccuracy !== null && wordAccuracy >= 0 && wordAccuracy <= 100
      ? { wordAccuracy: Math.round(wordAccuracy * 10) / 10 }
      : {}),
    ...(reading && total !== null
      ? { readingComprehension: { correct: Math.min(correct, total), total } }
      : {})
  };
}

function normalizeBandRows(bands) {
  const rows = (Array.isArray(bands) ? bands : [])
    .map(item => {
      const band = text(item?.band, 100).toLocaleLowerCase('en-US');
      if (!band) return null;
      const successCount = nonNegativeCount(item.successCount);
      const failureCount = nonNegativeCount(item.failureCount);
      const directEvidenceCount = Math.min(MAX_COUNT, successCount + failureCount);
      if (!directEvidenceCount) return null;
      const independentSuccessCount = Math.min(successCount, nonNegativeCount(item.independentSuccessCount));
      const independentFailureCount = Math.min(failureCount, nonNegativeCount(item.independentFailureCount));
      const independentDirectEvidenceCount = independentSuccessCount + independentFailureCount;
      return {
        band,
        directEvidenceCount,
        independentDirectEvidenceCount,
        masteryProbability: boundedProbability(item.masteryProbability),
        confidence: boundedProbability(item.confidence),
        independentMasteryProbability: boundedProbability(item.independentMasteryProbability),
        independentConfidence: boundedProbability(item.independentConfidence)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.band.localeCompare(right.band))
    .slice(0, MAX_BANDS);

  return rows;
}

function normalizeDifficultyFeedback(value) {
  if (!value || typeof value !== 'object') return null;
  const normalized = text(value.value, 20).toLocaleLowerCase('en-US');
  if (!FEEDBACK_VALUES.has(normalized)) return null;
  return {
    value: normalized,
    qualifiedReadingCount: nonNegativeCount(value.qualifiedReadingCount, 100),
    submittedAt: finiteNumber(value.submittedAt)
  };
}

function summarizeAbilityEvidence({ knowledge = {}, calibrationStatus, assessmentProfile } = {}) {
  const readStatus = knowledge.status === 'unavailable' ? 'unavailable' : 'available';
  const frequencyBands = readStatus === 'available' ? normalizeBandRows(knowledge.bands) : [];
  const directEvidenceCount = frequencyBands.reduce((sum, row) => sum + row.directEvidenceCount, 0);
  const independentDirectEvidenceCount = frequencyBands.reduce((sum, row) => sum + row.independentDirectEvidenceCount, 0);
  const hasIndependentEvidence = independentDirectEvidenceCount > 0;
  // The first learner-profile version deliberately does not promote an
  // overall learner to `established`; that conclusion needs a separately
  // agreed policy instead of a threshold invented by this projection.
  const status = readStatus === 'unavailable' || !hasIndependentEvidence
    ? 'insufficient'
    : 'provisional';
  const calibration = parseAssessmentProfile(assessmentProfile);
  const normalizedFeedback = normalizeDifficultyFeedback(knowledge.difficultyFeedback);

  return {
    status,
    knowledgeProfileReadStatus: readStatus,
    hasValidEvidence: hasIndependentEvidence,
    hasSufficientValidEvidence: false,
    knowledgeProfile: {
      hasValidEvidence: hasIndependentEvidence,
      hasSufficientValidEvidence: false,
      frequencyBandCount: frequencyBands.length,
      directEvidenceCount,
      independentDirectEvidenceCount
    },
    frequencyBands,
    calibrationEvidence: {
      status: calibrationStatus,
      stage: calibrationStage(calibrationStatus),
      ...(calibration || {})
    },
    recentDifficultyFeedback: normalizedFeedback,
    interpretation: '掌握概率只来自独立词义/复习证据；校准、难度反馈和材料设置不等同于实际掌握率。'
  };
}

function normalizeSettings(settings = {}) {
  const targetTrack = normalizeSelectableTrack(settings.targetTrack);
  const readingMode = ['support', 'standard', 'stretch'].includes(text(settings.readingMode, 20))
    ? text(settings.readingMode, 20)
    : 'support';
  const calibrationStatus = normalizeCalibrationStatus(settings.calibrationStatus);
  const targetCoveragePercent = finiteNumber(settings.coverage);
  const newWordPercent = finiteNumber(settings.newWordPercent);
  const difficulty = getDifficultyProfile(targetTrack || 'cet4', readingMode);
  const personalization = buildReadingPersonalization({
    calibrationStatus,
    challenge: readingMode,
    coverage: targetCoveragePercent
  });

  return {
    targetTrack,
    readingMode,
    calibrationStatus,
    targetCoveragePercent: targetCoveragePercent !== null && targetCoveragePercent >= 0 && targetCoveragePercent <= 100
      ? Math.round(targetCoveragePercent * 10) / 10
      : null,
    newWordPercent: newWordPercent !== null && newWordPercent >= 0 && newWordPercent <= 100
      ? Math.round(newWordPercent * 10) / 10
      : null,
    difficulty,
    personalization,
    assessmentDate: text(settings.assessmentDate, 48),
    assessmentProfile: settings.assessmentProfile
  };
}

/**
 * Creates a small, model-facing projection of learner settings and evidence.
 * It intentionally accepts an already isolated knowledge-profile summary and
 * never reads vocabulary, saved articles, or raw evidence records.
 */
export function buildLearnerProfile({ settings = {}, knowledge = {} } = {}) {
  const normalized = normalizeSettings(settings);
  const { targetTrack, readingMode, calibrationStatus, difficulty, personalization } = normalized;

  return {
    source: 'learner_profile',
    schemaVersion: 1,
    learnerSettings: {
      targetExam: {
        id: targetTrack,
        label: targetTrack ? getTrackLabel(targetTrack) : null
      },
      readingPressure: {
        configuredMode: readingMode,
        configuredLabel: difficulty.coverageLabel,
        effectiveStrategy: personalization.mode,
        coverageRange: difficulty.coverageRange,
        configuredCoveragePercent: normalized.targetCoveragePercent,
        recommendedCoveragePercent: personalization.recommendedCoverage ?? null
      },
      calibration: {
        status: calibrationStatus,
        stage: calibrationStage(calibrationStatus),
        completed: calibrationStatus === 'calibrated',
        assessmentDate: normalized.assessmentDate || null
      },
      configuredTargets: {
        targetCoveragePercent: normalized.targetCoveragePercent,
        recommendedCoveragePercent: personalization.recommendedCoverage ?? null,
        newWordPercent: normalized.newWordPercent,
        meaning: '材料目标配置，不是学习者实际掌握率或词汇量测量。'
      }
    },
    abilityEvidence: summarizeAbilityEvidence({
      knowledge,
      calibrationStatus,
      assessmentProfile: normalized.assessmentProfile
    })
  };
}

/**
 * Composition adapter for the home Agent. Config and the knowledge-profile
 * repository are injected so the Agent itself remains persistence-agnostic.
 */
export function createLearnerProfileProvider({ config, knowledgeProfile } = {}) {
  const readSetting = key => config?.get?.(key) ?? '';

  return {
    async getProfile() {
      let knowledge = { status: 'available', bands: [] };
      if (typeof knowledgeProfile?.getSummary === 'function') {
        try {
          knowledge = await knowledgeProfile.getSummary();
        } catch {
          knowledge = { status: 'unavailable', bands: [] };
        }
      } else {
        knowledge = { status: 'unavailable', bands: [] };
      }
      return buildLearnerProfile({
        settings: {
          targetTrack: readSetting('exam_level'),
          readingMode: readSetting('reading_mode'),
          calibrationStatus: readSetting('calibration_status'),
          coverage: readSetting('coverage'),
          newWordPercent: readSetting('new_word_percent'),
          assessmentDate: readSetting('assessment_date'),
          assessmentProfile: readSetting('assessment_profile')
        },
        knowledge
      });
    }
  };
}
