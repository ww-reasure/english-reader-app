const REQUIRED_SOURCE_STRING_FIELDS = [
  'id',
  'title',
  'url',
  'version',
  'license',
  'licenseUrl',
  'retrievedAt',
  'sha256',
  'purpose',
  'attribution',
  'snapshotPath',
  'status'
];

export const LEXICON_SCHEMA_VERSION = 1;
export const QUALITY_TIERS = Object.freeze(['high', 'screened', 'limited', 'rejected']);
// A source may enter the active core only after a reviewed build path consumes
// its checksum-pinned snapshot. CEFR-J has that parser; the partial OEWN
// snapshots remain provenance-only until a complete lexical/definition merge
// is implemented.
const ACTIVE_CORE_SOURCE_PURPOSES = new Set([
  'frequency',
  'lookup-frequency',
  'academic',
  'definition',
  'zh-gloss',
  'cefr'
]);
const DECLARED_SOURCE_PURPOSES = new Set([
  ...ACTIVE_CORE_SOURCE_PURPOSES,
  'lexeme',
  'cefr',
  'exam-focus'
]);
const ACTIVE_CORE_STATUS = 'active-core';
const RESERVED_NOT_CORE_STATUS = 'reserved-not-core';
const SOURCE_STATUSES = new Set([ACTIVE_CORE_STATUS, RESERVED_NOT_CORE_STATUS]);
// These fixed snapshots stay declared and checksum-verified, but their data
// does not yet have a reviewed parser/build path.  Listing them here makes an
// accidental status flip fail closed until the corresponding implementation is
// intentionally added.
const RESERVED_NOT_CORE_SOURCE_IDS = new Set([
  'oewn-2025-entries-a',
  'oewn-2025-verb-possession'
]);
const LAYER_PURPOSES = Object.freeze({
  frequency: 'frequency',
  lookupFrequency: 'lookup-frequency',
  academic: 'academic',
  cefr: 'cefr'
});
const LEGACY_DOMAIN_TAG = /\[(?:医|法|化|计|经|地名|网络)\]/u;

function isAbsoluteWebUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function assertLexiconManifest(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object') {
    errors.push('manifest 必须是对象');
  }

  if (manifest?.schemaVersion !== LEXICON_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须为 ${LEXICON_SCHEMA_VERSION}`);
  }

  if (typeof manifest?.lexiconVersion !== 'string' || !manifest.lexiconVersion.trim()) {
    errors.push('lexiconVersion 缺失');
  }

  if (!Array.isArray(manifest?.sources) || manifest.sources.length === 0) {
    errors.push('sources 必须是非空数组');
  } else {
    const sourceIds = new Set();
    manifest.sources.forEach((source, index) => {
      REQUIRED_SOURCE_STRING_FIELDS.forEach((field) => {
        if (typeof source?.[field] !== 'string' || !source[field].trim()) {
          errors.push(`sources[${index}].${field} 缺失`);
        }
      });
      for (const field of ['url', 'licenseUrl']) {
        if (typeof source?.[field] === 'string' && source[field].trim() && !isAbsoluteWebUrl(source[field])) {
          errors.push(`sources[${index}].${field} 必须是绝对 HTTP(S) URL`);
        }
      }
      if (!Number.isSafeInteger(source?.byteSize) || source.byteSize <= 0) {
        errors.push(`sources[${index}].byteSize 必须是正整数`);
      }
      if (typeof source?.sha256 === 'string' && !/^[a-f0-9]{64}$/i.test(source.sha256)) {
        errors.push(`sources[${index}].sha256 必须是 64 位 SHA-256 摘要`);
      }
      if (typeof source?.purpose === 'string' && source.purpose.trim()
        && !DECLARED_SOURCE_PURPOSES.has(source.purpose)) {
        errors.push(`sources[${index}].purpose 不支持：${source.purpose}`);
      }
      if (typeof source?.status === 'string' && source.status.trim()
        && !SOURCE_STATUSES.has(source.status)) {
        errors.push(`sources[${index}].status 不支持：${source.status}`);
      }
      if (source?.status === ACTIVE_CORE_STATUS && !ACTIVE_CORE_SOURCE_PURPOSES.has(source?.purpose)) {
        errors.push(`sources[${index}].purpose 未激活或不支持当前核心：${source?.purpose || '未知'}`);
      }
      if (RESERVED_NOT_CORE_SOURCE_IDS.has(source?.id) && source?.status !== RESERVED_NOT_CORE_STATUS) {
        errors.push(`sources[${index}].id 是预留来源，必须标记为 ${RESERVED_NOT_CORE_STATUS}`);
      }
      if (typeof source?.id === 'string' && source.id.trim()) {
        if (sourceIds.has(source.id)) {
          errors.push(`sources[${index}].id 重复：${source.id}`);
        }
        sourceIds.add(source.id);
      }
    });
  }

  if (errors.length) {
    throw new Error(`词库来源清单无效：${errors.join('；')}`);
  }

  return manifest;
}

/**
 * Applies the additional evidence requirements for an APK/release artifact.
 * Generic parser and fixture manifests intentionally use assertLexiconManifest
 * only; they do not claim that their data is ready for redistribution.
 */
export function assertLexiconReleaseManifest(manifest) {
  assertLexiconManifest(manifest);
  const errors = [];

  manifest.sources.forEach((source, index) => {
    if (source?.status !== ACTIVE_CORE_STATUS) return;
    for (const field of ['redistribution', 'derivativeLicense', 'changeNotice']) {
      if (typeof source?.[field] !== 'string' || !source[field].trim()) {
        errors.push(`sources[${index}].${field} 缺失`);
      }
    }
    if (source?.redistribution !== 'permitted') {
      errors.push(`sources[${index}].redistribution 必须为 permitted`);
    }
  });

  if (errors.length) throw new Error(`词库发布来源清单无效：${errors.join('；')}`);
  return manifest;
}

export function buildCoreLexicon({ manifest, entries, generatedAt }) {
  assertLexiconManifest(manifest);

  if (!Array.isArray(entries)) {
    throw new Error('词库词条必须是数组');
  }

  const sourceById = activeCoreSourceById(manifest);
  const normalizedLemmas = new Set();
  const normalizedEntries = entries.map((entry) => {
    assertDeclaredEntrySources(entry, sourceById);
    const lemmaKey = entry.lemma.trim().toLowerCase();
    if (normalizedLemmas.has(lemmaKey)) {
      throw new Error(`核心词库存在重复 lemma：${entry.lemma}`);
    }
    normalizedLemmas.add(lemmaKey);
    return {
      ...entry,
      forms: [...new Set(entry.forms || [])].sort()
    };
  }).sort((left, right) => left.lemma.localeCompare(right.lemma));

  const artifact = {
    schemaVersion: LEXICON_SCHEMA_VERSION,
    lexiconVersion: manifest.lexiconVersion,
    generatedAt,
    sourceIds: [...new Set(normalizedEntries.flatMap((entry) => entry.sourceRefs || []))].sort(),
    entryCount: normalizedEntries.length,
    entries: normalizedEntries
  };

  return assertCoreLexiconArtifact(artifact, manifest);
}

export function assertCoreLexiconArtifact(core, manifest) {
  assertLexiconManifest(manifest);

  if (!core || typeof core !== 'object') throw new Error('核心词库格式无效');
  if (core.schemaVersion !== LEXICON_SCHEMA_VERSION || core.schemaVersion !== manifest.schemaVersion) {
    throw new Error('核心词库 schemaVersion 不匹配');
  }
  if (core.lexiconVersion !== manifest.lexiconVersion) throw new Error('核心词库版本不匹配');
  if (!Array.isArray(core.entries) || core.entryCount !== core.entries.length) {
    throw new Error('核心词库条目数量不匹配');
  }

  const sourceById = activeCoreSourceById(manifest);
  const coreSourceIds = new Set(core.sourceIds || []);
  for (const sourceId of coreSourceIds) {
    if (!sourceById.has(sourceId)) throw new Error(`核心词库引用了未声明来源：${sourceId}`);
  }

  for (const entry of core.entries) {
    assertDeclaredEntrySources(entry, sourceById);
    for (const sourceId of entry.sourceRefs || []) {
      if (!coreSourceIds.has(sourceId)) {
        throw new Error(`核心词库缺少词条 ${entry?.lemma || '未知'} 的来源声明：${sourceId}`);
      }
    }
  }

  return core;
}

function activeCoreSourceById(manifest) {
  return new Map(manifest.sources
    .filter((source) => source.status === ACTIVE_CORE_STATUS)
    .map((source) => [source.id, source]));
}

function assertDeclaredEntrySources(entry, sourceById) {
  if (typeof entry?.lemma !== 'string' || !entry.lemma.trim()) {
    throw new Error('词条 lemma 缺失');
  }

  if (!QUALITY_TIERS.includes(entry?.quality)) {
    throw new Error(`词条 ${entry?.lemma || '未知'} 的 quality 无效`);
  }

  if (entry.quality === 'rejected') {
    throw new Error(`拒绝收录的词条不能进入核心词库：${entry?.lemma || '未知'}`);
  }

  if (['high', 'screened'].includes(entry.quality)
    && !entry?.senses?.some((sense) => typeof sense?.glossZh === 'string' && sense.glossZh.trim())) {
    throw new Error(`${entry.quality === 'high' ? '高可信' : '离线筛选'}词条必须提供 glossZh：${entry?.lemma || '未知'}`);
  }

  for (const sense of entry?.senses || []) {
    if (typeof sense?.glossZh === 'string' && LEGACY_DOMAIN_TAG.test(sense.glossZh)) {
      throw new Error(`词条 ${entry?.lemma || '未知'} 的学习释义不能包含领域标签`);
    }
  }

  for (const sourceId of entry?.sourceRefs || []) {
    if (!sourceById.has(sourceId)) {
      throw new Error(`词条 ${entry?.lemma || '未知'} 引用了未声明来源：${sourceId}`);
    }
  }

  for (const sense of entry?.senses || []) {
    const senseSources = [];
    for (const sourceId of sense?.sourceRefs || []) {
      const source = sourceById.get(sourceId);
      if (!source) {
        throw new Error(`词条 ${entry?.lemma || '未知'} 的释义引用了未声明来源：${sourceId}`);
      }
      if ((sense.definitionEn || sense.glossZh) && !['definition', 'zh-gloss'].includes(source.purpose)) {
        throw new Error(`词条 ${entry?.lemma || '未知'} 的释义层来源未声明为 definition 或 zh-gloss：${sourceId}`);
      }
      senseSources.push(source);
    }
    if (['high', 'screened'].includes(entry.quality) && typeof sense?.glossZh === 'string' && sense.glossZh.trim()
      && !senseSources.some((source) => source.purpose === 'zh-gloss')) {
      throw new Error(`${entry.quality === 'high' ? '高可信' : '离线筛选'}词条必须提供中文释义来源：${entry?.lemma || '未知'}`);
    }
  }

  const summarySourceIds = new Set(entry?.sourceRefs || []);
  const nestedSourceIds = [
    ...(entry?.senses || []).flatMap((sense) => sense?.sourceRefs || []),
    ...Object.values(entry?.layers || {}).flatMap((layerValues) => {
      const values = Array.isArray(layerValues) ? layerValues : layerValues ? [layerValues] : [];
      return values.map((value) => value?.sourceRef).filter(Boolean);
    })
  ];
  for (const sourceId of nestedSourceIds) {
    if (!summarySourceIds.has(sourceId)) {
      throw new Error(`词条 ${entry?.lemma || '未知'} 的来源汇总缺少：${sourceId}`);
    }
  }

  const declaredLayers = entry?.layers && typeof entry.layers === 'object' ? entry.layers : {};
  for (const layerName of Object.keys(declaredLayers)) {
    if (!Object.hasOwn(LAYER_PURPOSES, layerName)) {
      throw new Error(`词条 ${entry?.lemma || '未知'} 的 ${layerName} 层尚未激活，不能进入核心词库`);
    }
  }

  for (const [layerName, requiredPurpose] of Object.entries(LAYER_PURPOSES)) {
    const layerValues = entry?.layers?.[layerName];
    const values = Array.isArray(layerValues) ? layerValues : layerValues ? [layerValues] : [];

    for (const value of values) {
      const source = sourceById.get(value?.sourceRef);
      if (!source) {
        throw new Error(`词条 ${entry?.lemma || '未知'} 的 ${layerName} 层引用了未声明来源：${value?.sourceRef || '未知'}`);
      }
      if (source.purpose !== requiredPurpose) {
        const label = layerName === 'cefr' ? 'CEFR' : layerName;
        throw new Error(`词条 ${entry?.lemma || '未知'} 的 ${label} 层来源未声明为 ${requiredPurpose}`);
      }
    }
  }
}
