const FOCUS_SCHEMA_VERSION = 1;
const TRACK_IDS = Object.freeze(['cet4', 'cet6', 'kaoyan-general']);
const WORD_PATTERN = /^[a-z]+(?:[-'][a-z]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/i;

function normalizedWord(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function trackValues(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim())
    .filter(item => TRACK_IDS.includes(item)))].sort();
}

function requireNonEmptyString(value, field, errors) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`${field} 缺失`);
}

function assertTrackSource(trackSource, track, errors) {
  requireNonEmptyString(trackSource?.url, `source.tracks.${track}.url`, errors);
  if (!COMMIT_PATTERN.test(String(trackSource?.commit || ''))) {
    errors.push(`source.tracks.${track}.commit 必须是 40 位 Git 提交`);
  }
  if (!SHA256_PATTERN.test(String(trackSource?.sha256 || ''))) {
    errors.push(`source.tracks.${track}.sha256 必须是 64 位 SHA-256`);
  }
  for (const field of ['byteSize', 'rawRecordCount', 'normalizedWordCount']) {
    if (!Number.isSafeInteger(trackSource?.[field]) || trackSource[field] <= 0) {
      errors.push(`source.tracks.${track}.${field} 必须是正整数`);
    }
  }
}

export function assertExamFocusArtifact(artifact) {
  const errors = [];
  if (!artifact || typeof artifact !== 'object') errors.push('考试重点词表必须是对象');
  if (artifact?.schemaVersion !== FOCUS_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须为 ${FOCUS_SCHEMA_VERSION}`);
  }
  requireNonEmptyString(artifact?.focusVersion, 'focusVersion', errors);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(artifact?.generatedAt || ''))) {
    errors.push('generatedAt 必须是固定 UTC 时间');
  }

  requireNonEmptyString(artifact?.source?.id, 'source.id', errors);
  requireNonEmptyString(artifact?.source?.sourceType, 'source.sourceType', errors);
  if (artifact?.source?.useBoundary !== 'exam-direction-only-not-official-truth') {
    errors.push('source.useBoundary 必须明确为非官方考试真值');
  }

  for (const track of TRACK_IDS) {
    assertTrackSource(artifact?.source?.tracks?.[track], track, errors);
    const words = artifact?.tracks?.[track];
    if (!Array.isArray(words) || !words.length) {
      errors.push(`tracks.${track} 必须是非空数组`);
      continue;
    }
    const normalized = words.map(normalizedWord);
    if (normalized.some(word => !WORD_PATTERN.test(word))) {
      errors.push(`tracks.${track} 包含未规范化词条`);
    }
    if (new Set(normalized).size !== normalized.length) {
      errors.push(`tracks.${track} 包含重复词条`);
    }
    if (normalized.some((word, index) => word !== words[index])) {
      errors.push(`tracks.${track} 必须按小写规范化`);
    }
    if (normalized.some((word, index) => index > 0 && word.localeCompare(normalized[index - 1]) < 0)) {
      errors.push(`tracks.${track} 必须按字母排序`);
    }
    if (artifact?.source?.tracks?.[track]?.normalizedWordCount !== words.length) {
      errors.push(`tracks.${track} 与来源规范化计数不一致`);
    }
  }

  if (errors.length) throw new Error(`考试重点词表无效：${errors.join('；')}`);
  return artifact;
}

export function createExamFocusIndex(artifact) {
  assertExamFocusArtifact(artifact);
  const tracksByWord = new Map();
  for (const track of TRACK_IDS) {
    for (const word of artifact.tracks[track]) {
      const tracks = tracksByWord.get(word) || [];
      tracks.push(track);
      tracksByWord.set(word, tracks);
    }
  }
  for (const [word, tracks] of tracksByWord) tracksByWord.set(word, trackValues(tracks));

  return Object.freeze({
    focusVersion: artifact.focusVersion,
    sourceId: artifact.source.id,
    lookup(word) {
      return tracksByWord.get(normalizedWord(word)) || [];
    }
  });
}

export function mergeExamFocusIntoEntry(entry, tracks, artifact) {
  const normalizedTracks = trackValues(tracks);
  if (!normalizedTracks.length) return entry || null;
  assertExamFocusArtifact(artifact);

  const sourceRef = artifact.source.id;
  const currentLayers = entry?.layers && typeof entry.layers === 'object' ? entry.layers : {};
  const sourceRefs = [...new Set([...(entry?.sourceRefs || []), sourceRef])];
  return {
    ...(entry || {
      lemma: normalizedTracks[0],
      forms: [],
      senses: [],
      quality: 'limited'
    }),
    layers: {
      ...currentLayers,
      examFocus: [{
        tracks: normalizedTracks,
        sourceRef,
        focusVersion: artifact.focusVersion
      }]
    },
    sourceRefs
  };
}

export function createFocusOnlyEntry(word, tracks, artifact) {
  const lemma = normalizedWord(word);
  if (!WORD_PATTERN.test(lemma)) return null;
  return mergeExamFocusIntoEntry({
    lemma,
    forms: [lemma],
    senses: [],
    layers: {},
    quality: 'limited',
    sourceRefs: []
  }, tracks, artifact);
}
