const OEWN_SOURCE_ID = 'oewn-2025-json';
const POSITIONS = new Set(['noun', 'verb', 'adjective', 'adverb']);
const FORBIDDEN_ARTIFACT_ENTRY_FIELDS = new Set(['forms', 'layers', 'frequency', 'difficulty', 'examFocus', 'glossZh']);

const text = value => String(value || '').trim();
const normalizeLemma = value => text(value).toLocaleLowerCase('en-US');

async function fetchJson(fetchFn, url) {
  const response = await fetchFn(url);
  if (!response?.ok) throw new Error(`OEWN 资源加载失败：${url}`);
  return response.json();
}

function sameSource(left, right) {
  return left?.id === right?.id
    && left?.sha256 === right?.sha256
    && left?.byteSize === right?.byteSize
    && left?.url === right?.url;
}

function assertSource(source) {
  if (!source || typeof source !== 'object') throw new Error('OEWN 来源缺失');
  if (source.id !== OEWN_SOURCE_ID) throw new Error('OEWN 来源标识无效');
  if (!/^[a-f0-9]{64}$/i.test(text(source.sha256))) throw new Error('OEWN 来源校验和无效');
  if (!Number.isSafeInteger(source.byteSize) || source.byteSize <= 0) throw new Error('OEWN 来源大小无效');
  if (source.purpose !== 'english-definition-structure' || source.status !== 'derived-core-definitions-only') {
    throw new Error('OEWN 来源用途无效');
  }
  return source;
}

function assertManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || manifest?.artifactVersion !== 'oewn-core-definitions-v1') {
    throw new Error('OEWN 来源清单版本无效');
  }
  assertSource(manifest.source);
  return manifest;
}

function assertArtifact(artifact, manifest) {
  if (artifact?.schemaVersion !== 1 || artifact?.artifactVersion !== 'oewn-core-definitions-v1') {
    throw new Error('OEWN 英文义项产物版本无效');
  }
  if (!text(artifact?.coreLexiconVersion)) throw new Error('OEWN 英文义项产物缺少核心词库版本');
  if (!sameSource(artifact.source, manifest.source)) throw new Error('OEWN 英文义项产物来源与清单不一致');
  if (!Array.isArray(artifact.entries) || artifact.entryCount !== artifact.entries.length) {
    throw new Error('OEWN 英文义项产物条目无效');
  }
  for (const entry of artifact.entries) {
    if (!/^[a-z]+$/.test(normalizeLemma(entry?.lemma)) || !POSITIONS.has(entry?.pos)) {
      throw new Error('OEWN 英文义项条目格式无效');
    }
    if (Object.keys(entry).some(key => FORBIDDEN_ARTIFACT_ENTRY_FIELDS.has(key))) {
      throw new Error('OEWN 英文义项产物含有禁止字段');
    }
    if (!Array.isArray(entry.senses) || !entry.senses.length || entry.senses.some((sense) => (
      !text(sense?.id) || !text(sense?.synsetId) || !text(sense?.definitionEn) || Object.hasOwn(sense, 'glossZh')
    ))) {
      throw new Error('OEWN 英文义项缺少可用定义');
    }
  }
  return artifact;
}

function entryKey(lemma, pos) {
  return `${normalizeLemma(lemma)}\u0000${pos}`;
}

/**
 * Lazy, read-only OEWN definition loader. It deliberately exposes only an
 * English definition and POS; the active core keeps authority for Chinese
 * learning glosses, frequency, CEFR and every difficulty decision.
 */
export function createOewnDefinitionLoader({ fetchFn = globalThis.fetch, dataUrl = '/data' } = {}) {
  if (typeof fetchFn !== 'function') throw new TypeError('OEWN 运行时加载器需要 fetchFn');
  const baseUrl = String(dataUrl || '/data').replace(/\/$/, '');
  let manifestPromise;
  let artifactPromise;
  let indexPromise;

  async function loadManifest() {
    manifestPromise ||= fetchJson(fetchFn, `${baseUrl}/oewn-artifact-manifest.json`).then(assertManifest);
    return manifestPromise;
  }

  async function loadArtifact() {
    artifactPromise ||= Promise.all([
      loadManifest(),
      fetchJson(fetchFn, `${baseUrl}/oewn-core-2025.json`)
    ]).then(([manifest, artifact]) => assertArtifact(artifact, manifest));
    return artifactPromise;
  }

  async function getIndex() {
    indexPromise ||= loadArtifact().then((artifact) => new Map(
      artifact.entries.map(entry => [entryKey(entry.lemma, entry.pos), entry])
    ));
    return indexPromise;
  }

  return {
    loadManifest,
    loadArtifact,
    async lookup({ lemma, pos, coreLexiconVersion } = {}) {
      const normalizedLemma = normalizeLemma(lemma);
      const normalizedPos = text(pos).toLocaleLowerCase('en-US');
      const expectedCoreVersion = text(coreLexiconVersion);
      if (!/^[a-z]+$/.test(normalizedLemma) || !POSITIONS.has(normalizedPos) || !expectedCoreVersion) return null;
      const artifact = await loadArtifact();
      if (artifact.coreLexiconVersion !== expectedCoreVersion) return null;
      const entry = (await getIndex()).get(entryKey(normalizedLemma, normalizedPos));
      const definitionEn = text(entry?.senses?.[0]?.definitionEn);
      return definitionEn ? { definitionEn, pos: normalizedPos } : null;
    }
  };
}
