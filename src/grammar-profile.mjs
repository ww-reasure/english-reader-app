const TRACK_ALIASES = new Map([
  ['cet4', 'cet4'],
  ['cet6', 'cet6'],
  ['graduate', 'kaoyan1'],
  ['kaoyan1', 'kaoyan1'],
  ['kaoyan2', 'kaoyan2'],
]);

const MODE_ALIASES = new Map([
  ['support', 'support'],
  ['consolidation', 'support'],
  ['benchmark', 'benchmark'],
  ['standard', 'benchmark'],
  ['stretch', 'stretch'],
  ['pressure', 'stretch'],
]);

const REQUIRED_FEATURES = ['maxDependencyDepth', 'clauseRelationCountPer100Tokens'];

export function createGrammarProfile({ track = 'cet4', mode = 'benchmark', calibration = { status: 'pending-corpus-calibration' } } = {}) {
  return {
    schemaVersion: 1,
    track: TRACK_ALIASES.get(String(track).toLowerCase()) || 'cet4',
    mode: MODE_ALIASES.get(String(mode).toLowerCase()) || 'benchmark',
    calibration,
  };
}

export function validateGrammarProfile(profile) {
  if (!profile || profile.schemaVersion !== 1 || !TRACK_ALIASES.has(profile.track) || !MODE_ALIASES.has(profile.mode)) {
    return { status: 'unavailable', reason: 'INVALID_PROFILE' };
  }
  const calibration = profile.calibration;
  if (!calibration || calibration.status !== 'calibrated') {
    return { status: 'unavailable', reason: 'PROFILE_NOT_CALIBRATED' };
  }
  if (!isNonEmptyString(calibration.corpusId) || !isNonEmptyString(calibration.corpusVersion) || !isRecord(calibration.features)) {
    return { status: 'unavailable', reason: 'INVALID_CALIBRATION' };
  }
  if (!REQUIRED_FEATURES.every(feature => isRange(calibration.features[feature]))) {
    return { status: 'unavailable', reason: 'INVALID_CALIBRATION' };
  }
  return { status: 'available', track: profile.track, mode: profile.mode };
}

function isRange(value) {
  return isRecord(value) && Number.isFinite(value.min) && Number.isFinite(value.max) && value.min <= value.max;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
