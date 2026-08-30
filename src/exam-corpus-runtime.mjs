import {
  assertExamCorpusIndexArtifact,
  assertExamCorpusIndexManifest,
  assertExamCorpusTrackArtifact,
  corpusTrackForTarget,
  ExamCorpusTracks
} from './exam-corpus.mjs';

const text = value => String(value || '').trim();
const normalizeWord = value => text(value).toLocaleLowerCase('en-US');

async function fetchJson(fetchFn, url) {
  const response = await fetchFn(url);
  if (!response?.ok || typeof response.json !== 'function') throw new Error(`真题语料资源加载失败：${url}`);
  return response.json();
}

function assertExampleManifest(value, corpusVersion) {
  if (value?.schemaVersion !== 1 || value?.corpusVersion !== corpusVersion || !value?.shards || typeof value.shards !== 'object') {
    throw new Error('真题例句清单与词频索引不匹配');
  }
  return value;
}

function assertExampleShard(value, { corpusVersion, track, bucket }) {
  if (value?.schemaVersion !== 1 || value?.corpusVersion !== corpusVersion || value?.track !== track || value?.bucket !== bucket) {
    throw new Error('真题例句分片无效');
  }
  if (!value.items || typeof value.items !== 'object' || Array.isArray(value.items)) throw new Error('真题例句分片缺少词条');
  return value;
}

export function createExamCorpusService({ fetchFn = globalThis.fetch, dataUrl = '/data' } = {}) {
  if (typeof fetchFn !== 'function') throw new TypeError('真题语料服务需要 fetchFn');
  const baseUrl = String(dataUrl || '/data').replace(/\/$/, '');
  let indexArtifactPromise;
  let exampleManifestPromise;
  const trackPromises = new Map();
  const shardPromises = new Map();

  async function loadIndexArtifact() {
    indexArtifactPromise ||= fetchJson(fetchFn, `${baseUrl}/exam-corpus-index.json`).then(value => (
      value?.schemaVersion === 2
        ? assertExamCorpusIndexManifest(value)
        : assertExamCorpusIndexArtifact(value)
    ));
    return indexArtifactPromise;
  }

  async function loadTrack(track) {
    if (!track) return {};
    if (trackPromises.has(track)) return trackPromises.get(track);
    const promise = loadIndexArtifact().then(async artifact => {
      if (artifact.schemaVersion === 1) return artifact.words?.[track] || {};
      const meta = artifact.tracks?.[track];
      if (!meta?.path) throw new Error(`真题词频轨道不存在：${track}`);
      const trackArtifact = await fetchJson(fetchFn, `${baseUrl}/${meta.path}`);
      return assertExamCorpusTrackArtifact(trackArtifact, {
        corpusVersion: artifact.corpusVersion,
        track,
        wordCount: meta.wordCount
      }).words;
    });
    trackPromises.set(track, promise);
    return promise;
  }

  async function loadExampleManifest() {
    const artifact = await loadIndexArtifact();
    exampleManifestPromise ||= fetchJson(fetchFn, `${baseUrl}/exam-examples/manifest.json`)
      .then(value => assertExampleManifest(value, artifact.corpusVersion));
    return exampleManifestPromise;
  }

  async function loadShard(shardKey) {
    if (shardPromises.has(shardKey)) return shardPromises.get(shardKey);
    const promise = Promise.all([loadIndexArtifact(), loadExampleManifest()]).then(async ([artifact, manifest]) => {
      const meta = manifest.shards[shardKey];
      if (!meta?.path) throw new Error(`真题例句分片不存在：${shardKey}`);
      const separator = shardKey.lastIndexOf('-');
      const track = shardKey.slice(0, separator);
      const bucket = shardKey.slice(separator + 1);
      const shard = await fetchJson(fetchFn, `${baseUrl}/exam-examples/${meta.path}`);
      return assertExampleShard(shard, { corpusVersion: artifact.corpusVersion, track, bucket });
    });
    shardPromises.set(shardKey, promise);
    return promise;
  }

  return Object.freeze({
    loadIndexArtifact,

    async preload(targetTrack) {
      const track = corpusTrackForTarget(targetTrack);
      if (!track) return false;
      try {
        await loadTrack(track);
        return true;
      } catch {
        return false;
      }
    },

    async lookup(word, targetTrack) {
      const lemma = normalizeWord(word);
      const track = corpusTrackForTarget(targetTrack);
      if (!lemma || !track) return null;
      try {
        return (await loadTrack(track))[lemma] || null;
      } catch {
        return null;
      }
    },

    async lookupAll(word) {
      const lemma = normalizeWord(word);
      if (!lemma) return {};
      try {
        const values = {};
        const tracks = await Promise.all(ExamCorpusTracks.map(loadTrack));
        for (let index = 0; index < ExamCorpusTracks.length; index += 1) {
          const track = ExamCorpusTracks[index];
          const record = tracks[index]?.[lemma];
          if (record) values[track] = record;
        }
        return values;
      } catch {
        return {};
      }
    },

    async getExamples(word, targetTrack, { limit = 6 } = {}) {
      const lemma = normalizeWord(word);
      const corpusTrack = corpusTrackForTarget(targetTrack);
      if (!lemma || !corpusTrack) return [];
      try {
        const record = await this.lookup(lemma, corpusTrack);
        if (!record?.exampleShard) return [];
        const shard = await loadShard(record.exampleShard);
        const rows = Array.isArray(shard.items?.[lemma]) ? shard.items[lemma] : [];
        const target = text(targetTrack).toLocaleLowerCase('en-US');
        const filtered = ['kaoyan1', 'kaoyan2'].includes(target)
          ? rows.filter(row => row?.examTrack === target)
          : rows;
        return filtered.slice(0, Math.max(0, Math.min(6, Number.parseInt(limit, 10) || 0)));
      } catch {
        return [];
      }
    }
  });
}

export const ExamCorpus = createExamCorpusService();
