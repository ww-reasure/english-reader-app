import { buildKeyPhraseMatcherIndex } from './components/word-marking.mjs';

/**
 * 重点词组库：public/data/key-phrases/ 下的 manifest + 分片 JSON。
 * manifest: { schemaVersion: 1, packVersion, tracks: { [track]: { path, phraseCount } } }
 * 分片:     { schemaVersion: 1, track, phrases: [{ p: 词组, g: 中文释义 }] }
 *
 * 运行时不感知 Config（保持纯模块、可直接单测）；targetTrack 由调用方传入。
 */

export function assertKeyPhraseManifest(value) {
  if (value?.schemaVersion !== 1 || !value?.packVersion || !value?.tracks || typeof value.tracks !== 'object') {
    throw new Error('重点词组清单无效');
  }
  for (const meta of Object.values(value.tracks)) {
    if (!meta?.path) throw new Error('重点词组清单缺少分片路径');
  }
  return value;
}

export function assertKeyPhrasePack(value, { track }) {
  if (value?.schemaVersion !== 1 || value?.track !== track || !Array.isArray(value?.phrases)) {
    throw new Error('重点词组分片无效');
  }
  for (const row of value.phrases) {
    if (!String(row?.p || '').trim()) throw new Error('重点词组分片存在空词组');
  }
  return value;
}

const KAOYAN_TRACKS = new Set(['kaoyan', 'kaoyan1', 'kaoyan2', 'kaoyan-general']);
const KNOWN_TRACKS = new Set(['general', 'cet4', 'cet6']);

export function createKeyPhraseLibrary({ fetchFn = globalThis.fetch, dataUrl = '/data' } = {}) {
  if (typeof fetchFn !== 'function') throw new TypeError('重点词组库需要 fetchFn');
  const baseUrl = String(dataUrl || '/data').replace(/\/$/, '');
  let manifestPromise;
  const packPromises = new Map();
  const matcherPromises = new Map();

  async function fetchJson(url) {
    const response = await fetchFn(url);
    if (!response?.ok || typeof response.json !== 'function') throw new Error(`重点词组资源加载失败：${url}`);
    return response.json();
  }

  function loadManifest() {
    manifestPromise ||= fetchJson(`${baseUrl}/key-phrases/manifest.json`).then(assertKeyPhraseManifest);
    return manifestPromise;
  }

  // kaoyan1/kaoyan2 语料同源（kaoyan-general），词组分片同样合并为 kaoyan。
  // 未知的 target 一律回落 general 默认分片，宁可少高亮也不错轨。
  function resolveTargetTrack(targetTrack) {
    const value = String(targetTrack || '').trim().toLowerCase();
    if (!value) return 'general';
    if (KAOYAN_TRACKS.has(value)) return 'kaoyan';
    return KNOWN_TRACKS.has(value) ? value : 'general';
  }

  async function loadPack(track) {
    const manifest = await loadManifest();
    const meta = manifest.tracks?.[track];
    if (!meta?.path) return null;
    const path = String(meta.path).replace(/^\//, '');
    return fetchJson(`${baseUrl}/key-phrases/${path}`).then(value => assertKeyPhrasePack(value, { track }));
  }

  async function getMatcher({ targetTrack = '', track } = {}) {
    const resolved = track || resolveTargetTrack(targetTrack);
    if (matcherPromises.has(resolved)) return matcherPromises.get(resolved);
    const promise = loadPack(resolved)
      .then(pack => buildKeyPhraseMatcherIndex(pack ? pack.phrases : []))
      .catch(error => {
        matcherPromises.delete(resolved);
        throw error;
      });
    matcherPromises.set(resolved, promise);
    return promise;
  }

  async function getPhraseById(phraseId, { targetTrack = '', track } = {}) {
    const resolved = track || resolveTargetTrack(targetTrack);
    try {
      const matcher = await getMatcher({ track: resolved });
      const key = String(phraseId || '').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
      return matcher.byId.get(key) || null;
    } catch {
      return null;
    }
  }

  return Object.freeze({
    loadManifest,
    resolveTargetTrack,
    getMatcher,
    getPhraseById
  });
}

export const KeyPhraseLibrary = createKeyPhraseLibrary();
