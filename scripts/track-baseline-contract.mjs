/**
 * Maintainer-side admission contract for target-exam derived statistics.
 *
 * This intentionally does not read or distribute examination text.  It only
 * decides whether a registry contains enough immutable provenance to allow
 * derived statistics to be used by the generator or grammar validator.
 */
export const TRACK_BASELINE_TRACKS = Object.freeze(['cet4', 'cet6', 'kaoyan1', 'kaoyan2']);

export const TRACK_BASELINE_REQUIRED_EVIDENCE = Object.freeze([
  'licensed-or-permitted-raw-corpus',
  'immutable-source-snapshot-and-sha256',
  'reproducible-tokenization-and-derived-statistics',
  'same-tokenizer-and-udpipe-metric-schema',
  'per-track-sample-size-and-distribution-report',
  'human-legal-and-methodology-review'
]);

const ACTIVATION_USES = Object.freeze({
  generation: 'generation-target-focus',
  validator: 'validator-syntax-baseline'
});

const FORBIDDEN_APP_ARTIFACTS = Object.freeze([
  'raw-test-text-in-apk',
  'answers-in-apk',
  'options-in-apk',
  'recoverable-ngram-tables'
]);

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const positiveInteger = value => Number.isInteger(value) && value > 0;
const toSet = values => new Set(Array.isArray(values) ? values : []);

function createReport() {
  const errors = [];
  return {
    errors,
    add(code, path, message) {
      errors.push({ code, path, message });
    },
    finish(activationState) {
      return { ok: errors.length === 0, activationState, errors };
    }
  };
}

function requireFields(report, value, fields, path, code = 'missing_field') {
  for (const field of fields) {
    if (!nonEmpty(value?.[field])) report.add(code, `${path}.${field}`, `${path}.${field} is required`);
  }
}

function hasAll(values, required) {
  const actual = toSet(values);
  return required.every(item => actual.has(item));
}

function validateAdmissionPolicy(policy, report, path) {
  if (!isObject(policy)) {
    report.add('missing_admission_policy', path, `${path} is required`);
    return;
  }
  if (policy.shipRawExamTextInApk !== false) {
    report.add('raw_exam_text_must_not_ship', `${path}.shipRawExamTextInApk`, 'Raw examination text must never ship in the APK.');
  }
  if (policy.acceptedBuildOutput !== 'derived-statistics-only') {
    report.add('derived_statistics_only', `${path}.acceptedBuildOutput`, 'Only derived statistics may be accepted as a build output.');
  }
  if (!hasAll(policy.requiredEvidence, TRACK_BASELINE_REQUIRED_EVIDENCE)) {
    report.add('incomplete_admission_evidence', `${path}.requiredEvidence`, 'The admission policy must retain every required provenance check.');
  }
}

function validateDerivedArtifact(artifact, report, path) {
  if (!isObject(artifact)) {
    report.add('active_track_missing_derived_artifact', path, 'An active track needs a derived-only artifact record.');
    return false;
  }

  requireFields(report, artifact, ['id', 'version', 'generatedAt', 'scriptVersion', 'metricSchema'], path, 'derived_artifact_missing_field');
  if (!sha256(artifact.sha256)) report.add('derived_artifact_missing_sha256', `${path}.sha256`, 'The derived artifact needs a SHA-256 digest.');
  if (!positiveInteger(artifact.byteSize)) report.add('derived_artifact_missing_size', `${path}.byteSize`, 'The derived artifact needs a positive byte size.');
  if (artifact.metricSchema !== 'udpipe-dependency-v1') {
    report.add('derived_artifact_metric_schema', `${path}.metricSchema`, 'The artifact must use the app UDPipe metric schema.');
  }

  const tokenizer = artifact.tokenizer;
  if (!isObject(tokenizer) || !nonEmpty(tokenizer.id) || !nonEmpty(tokenizer.version)) {
    report.add('derived_artifact_missing_tokenizer', `${path}.tokenizer`, 'The artifact needs a versioned tokenizer record.');
  }

  const rawCorpus = artifact.rawCorpus;
  if (!isObject(rawCorpus)) {
    report.add('derived_artifact_missing_raw_corpus_provenance', `${path}.rawCorpus`, 'The artifact needs non-distributed raw corpus provenance.');
  } else {
    requireFields(report, rawCorpus, ['authorization', 'license', 'snapshotId'], `${path}.rawCorpus`, 'raw_corpus_missing_field');
    if (!sha256(rawCorpus.sha256)) report.add('raw_corpus_missing_sha256', `${path}.rawCorpus.sha256`, 'The raw corpus snapshot needs a SHA-256 digest.');
    if (rawCorpus.notShippedInApk !== true) {
      report.add('raw_corpus_must_not_ship', `${path}.rawCorpus.notShippedInApk`, 'Raw corpus material must be excluded from the APK.');
    }
  }

  for (const forbiddenField of ['rawText', 'passages', 'answers', 'options', 'ngramTable']) {
    if (Object.hasOwn(artifact, forbiddenField)) {
      report.add('derived_artifact_contains_recoverable_exam_content', `${path}.${forbiddenField}`, 'Derived baseline artifacts must not contain recoverable examination content.');
    }
  }

  const statistics = artifact.trackStatistics;
  if (!isObject(statistics)) {
    report.add('derived_artifact_missing_track_statistics', `${path}.trackStatistics`, 'An active artifact needs per-track statistics.');
  } else {
    for (const track of TRACK_BASELINE_TRACKS) {
      const stat = statistics[track];
      if (!isObject(stat) || !positiveInteger(stat.documentCount) || !positiveInteger(stat.runningTokenCount) || !isObject(stat.distributionQuantiles)) {
        report.add('derived_artifact_incomplete_track_statistics', `${path}.trackStatistics.${track}`, 'Every active track needs sample counts and distribution quantiles.');
      }
    }
  }
  return true;
}

function validateActiveSource(source, report, path) {
  requireFields(report, source, ['id', 'title', 'sourceType', 'url', 'version', 'license', 'retrievedAt'], path, 'active_source_missing_field');
  if (!sha256(source.sha256)) report.add('active_source_missing_sha256', `${path}.sha256`, 'An active source needs an immutable source digest.');
  if (!positiveInteger(source.byteSize)) report.add('active_source_missing_size', `${path}.byteSize`, 'An active source needs a positive snapshot byte size.');
  const forbiddenUse = toSet(source.forbiddenUse);
  for (const item of FORBIDDEN_APP_ARTIFACTS) {
    if (!forbiddenUse.has(item)) report.add('active_source_missing_distribution_guard', `${path}.forbiddenUse`, `Active source must forbid ${item}.`);
  }
  validateDerivedArtifact(source.derivedArtifact, report, `${path}.derivedArtifact`);
}

function sourcesForTrack(sources, track) {
  return sources.filter(source => source?.status === 'active-derived-statistics' && Array.isArray(source.tracks) && source.tracks.includes(track));
}

function validateActiveTrackUse(sources, track, use, report) {
  const candidates = sourcesForTrack(sources, track);
  if (!candidates.some(source => Array.isArray(source.use) && source.use.includes(use))) {
    report.add('active_track_missing_eligible_use', `trackStatus.${track}`, `Active ${track} requires an audited source eligible for ${use}.`);
  }
  if (!candidates.some(source => isObject(source.derivedArtifact))) {
    report.add('active_track_missing_derived_artifact', `trackStatus.${track}`, `Active ${track} requires a derived-only statistics artifact.`);
  }
}

/**
 * Validates either the shipped disabled registry or a future derived-only
 * activation record. The function intentionally cannot accept raw passage
 * data: the artifact contract has no field for it and rejects known payloads.
 */
export function validateTrackBaselineRegistry(registry) {
  const report = createReport();
  if (!isObject(registry)) {
    report.add('registry_not_object', 'registry', 'Registry must be an object.');
    return report.finish('invalid');
  }

  if (!Number.isInteger(registry.schemaVersion)) report.add('registry_schema_version', 'schemaVersion', 'Registry schemaVersion must be an integer.');
  requireFields(report, registry, ['registryVersion', 'purpose'], 'registry', 'registry_missing_field');
  if (typeof registry.activeForGeneration !== 'boolean') report.add('registry_generation_flag', 'activeForGeneration', 'activeForGeneration must be boolean.');
  if (typeof registry.activeForValidator !== 'boolean') report.add('registry_validator_flag', 'activeForValidator', 'activeForValidator must be boolean.');
  if (!hasAll(registry.activationRequirements, TRACK_BASELINE_REQUIRED_EVIDENCE)) {
    report.add('registry_missing_activation_requirement', 'activationRequirements', 'Registry must preserve every activation requirement.');
  }
  validateAdmissionPolicy(registry.corpusAdmissionPolicy, report, 'corpusAdmissionPolicy');

  const sources = Array.isArray(registry.sources) ? registry.sources : [];
  if (!Array.isArray(registry.sources)) report.add('registry_sources', 'sources', 'Registry sources must be an array.');
  for (const [index, source] of sources.entries()) {
    const path = `sources[${index}]`;
    if (!isObject(source)) {
      report.add('source_not_object', path, 'Source must be an object.');
      continue;
    }
    requireFields(report, source, ['id', 'title', 'status', 'sourceType', 'url', 'version', 'license', 'retrievedAt'], path, 'source_missing_field');
    if (!Array.isArray(source.tracks) || source.tracks.length === 0) report.add('source_tracks', `${path}.tracks`, 'Source must identify its tracks.');
    if (!Array.isArray(source.use) || source.use.length === 0) report.add('source_use', `${path}.use`, 'Source must identify allowed uses.');
    if (!Array.isArray(source.forbiddenUse) || !source.forbiddenUse.includes('raw-test-text-in-apk')) {
      report.add('source_raw_text_guard', `${path}.forbiddenUse`, 'Every source must forbid raw test text in the APK.');
    }
    if (source.status === 'active-derived-statistics') validateActiveSource(source, report, path);
  }

  const activeGeneration = registry.activeForGeneration === true;
  const activeValidator = registry.activeForValidator === true;
  const active = activeGeneration || activeValidator;
  const statuses = isObject(registry.trackStatus) ? registry.trackStatus : {};
  if (!isObject(registry.trackStatus)) report.add('registry_track_status', 'trackStatus', 'trackStatus must be an object.');

  for (const track of TRACK_BASELINE_TRACKS) {
    const status = statuses[track];
    if (!isObject(status) || !nonEmpty(status.status)) {
      report.add('track_status_missing', `trackStatus.${track}`, `${track} needs an explicit status.`);
      continue;
    }
    if (active && status.status !== 'active-derived-statistics') {
      report.add('active_track_not_derived', `trackStatus.${track}.status`, `${track} cannot be active without derived statistics.`);
    }
    if (activeGeneration) validateActiveTrackUse(sources, track, ACTIVATION_USES.generation, report);
    if (activeValidator) validateActiveTrackUse(sources, track, ACTIVATION_USES.validator, report);
  }

  return report.finish(active ? (report.errors.length ? 'invalid-active' : 'active') : 'disabled');
}

/**
 * Ensures pending lexicon target-focus entries stay blocked until the separate
 * baseline registry is genuinely activated. It prevents a word layer from
 * being silently added just because someone found a public paper mirror.
 */
export function validateTrackFocusCatalog(catalog, registry) {
  const report = createReport();
  const registryReport = validateTrackBaselineRegistry(registry);
  if (!registryReport.ok) {
    report.add('registry_invalid', 'registry', 'Track-focus catalog cannot be evaluated against an invalid registry.');
  }
  if (!isObject(catalog) || !Array.isArray(catalog.pendingSources)) {
    report.add('catalog_pending_sources', 'pendingSources', 'Catalog pendingSources must be an array.');
    return report.finish('invalid');
  }

  const targets = catalog.pendingSources.filter(source => source?.role === 'exam-focus');
  for (const track of TRACK_BASELINE_TRACKS) {
    const source = targets.find(item => item.track === track);
    if (!source) {
      report.add('target_focus_missing_track', `pendingSources.${track}`, `Target focus source for ${track} is required.`);
      continue;
    }
    if (source.status !== 'blocked-corpus-provenance') {
      report.add('target_focus_must_stay_blocked', `pendingSources.${source.id}.status`, 'Target focus source remains blocked until registry activation.');
    }
    const guard = source.activationGuard;
    if (!isObject(guard)) {
      report.add('target_focus_missing_guard', `pendingSources.${source.id}.activationGuard`, 'Blocked target focus source needs an explicit activation guard.');
      continue;
    }
    if (guard.registryId !== 'track-baseline-registry') report.add('target_focus_registry_guard', `pendingSources.${source.id}.activationGuard.registryId`, 'Target focus source must point to the baseline registry.');
    if (guard.allowRawExamTextInApk !== false) report.add('target_focus_raw_text_guard', `pendingSources.${source.id}.activationGuard.allowRawExamTextInApk`, 'Target focus source must prohibit raw examination text in the APK.');
    if (guard.acceptedBuildOutput !== 'derived-statistics-only') report.add('target_focus_derived_only_guard', `pendingSources.${source.id}.activationGuard.acceptedBuildOutput`, 'Target focus source must only accept derived statistics.');
    if (!hasAll(guard.requiredEvidence, TRACK_BASELINE_REQUIRED_EVIDENCE)) report.add('target_focus_incomplete_guard', `pendingSources.${source.id}.activationGuard.requiredEvidence`, 'Target focus source guard is missing required audit evidence.');
    if (registryReport.activationState === 'active') {
      report.add('target_focus_pending_after_activation', `pendingSources.${source.id}`, 'Activated sources must leave pendingSources and be represented by an audited derived artifact.');
    }
  }
  const blockedTracks = targets.filter(source => source.status === 'blocked-corpus-provenance').map(source => source.track).filter(Boolean);
  const state = registryReport.activationState === 'active' ? 'invalid' : 'disabled';
  const result = report.finish(state);
  return { ...result, blockedTracks };
}
