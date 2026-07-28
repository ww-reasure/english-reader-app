/**
 * Converts persisted user state into an explicit generation contract.  It is
 * kept free of Config/UI imports so every article entry point can use the same
 * policy and tests can exercise cold-start behavior directly.
 */

const MODES = new Set(['support', 'standard', 'stretch']);
// Historical assessment state did not produce evidence compatible with the
// new frequency-band model. Treat it like a new reader until the user finishes
// the explicit calibration instead of making an unsupported coverage promise.
const CALIBRATED_STATUSES = new Set(['calibrated']);

const text = value => String(value || '').trim();

export function buildReadingPersonalization({ calibrationStatus, challenge, coverage } = {}) {
  const mode = MODES.has(text(challenge)) ? text(challenge) : 'support';
  const status = text(calibrationStatus) || 'new';
  const targetCoverage = parseCoverage(coverage);

  if (CALIBRATED_STATUSES.has(status) && targetCoverage !== null) {
    return {
      // Twenty-four diagnostic answers can recommend a pressure level, but
      // cannot honestly prove a 92–98% coverage claim. The quality gate may
      // later activate only after it sees sufficient independent evidence in
      // every frequency band used by an article.
      mode: 'evidence_collecting',
      calibrationStatus: status,
      challenge: mode,
      targetCoverage: null,
      recommendedCoverage: targetCoverage,
      prompt: '学习者已完成初测，当前继续收集独立掌握证据。优先使用高频核心词和清晰句法；不要声称具体覆盖率、词汇量或确定能力结论。'
    };
  }

  return {
    mode: 'uncalibrated_conservative',
    calibrationStatus: status,
    challenge: 'support',
    targetCoverage: null,
    prompt: '学习者尚未完成可用校准。请采用保守材料：优先高频基础词、较短句、清晰衔接，并只少量引入目标考试导向词。不要声称任何具体覆盖率、词汇量或“读者大概率认识”的比例。'
  };
}

/**
 * Keeps generation prompting and post-generation validation on the exact same
 * calibration contract.  Entry points must pass this object unchanged instead
 * of independently reading mutable UI settings at different stages.
 */
export function buildArticleGenerationPolicy(input = {}) {
  const personalization = buildReadingPersonalization(input);
  return {
    personalization,
    validationOptions: {
      personalization,
      calibrationStatus: personalization.calibrationStatus,
      targetCoverage: personalization.targetCoverage,
      recommendedCoverage: personalization.recommendedCoverage ?? null
    }
  };
}

function parseCoverage(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}
