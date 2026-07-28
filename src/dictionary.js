/**
 * Dictionary lookup with a traceable offline core.
 *
 * A Chinese gloss is displayed immediately only when the shipped lexicon marks
 * that sense as `high`.  Limited entries can contribute forms, frequency and
 * English structure, but their Chinese text is deliberately obtained from a
 * live translation fallback instead of inheriting an old mixed dictionary.
 */

import { API } from './api.js';
import { createLexiconLoader } from './lexicon-runtime.mjs';
import { createOewnDefinitionLoader } from './oewn-runtime.mjs';

const WORD_PATTERN = /[^a-z\-']/g;
const AUDIO_URL = word => `https://api.dictionaryapi.dev/media/pronunciations/en/${word}-uk.mp3`;
const CHINESE_TEXT = /[\u3400-\u9fff]/u;

const normalizeWord = value => String(value || '').toLocaleLowerCase('en-US').replace(WORD_PATTERN, '');
const text = value => String(value || '').trim();
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function getStemForms(word) {
  const forms = [word];
  const w = normalizeWord(word);
  if (w.endsWith('ies') && w.length > 4) forms.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 3) {
    forms.push(w.slice(0, -2));
    forms.push(w.slice(0, -1));
  }
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) forms.push(w.slice(0, -1));
  if (w.endsWith('ed') && w.length > 4) {
    forms.push(w.slice(0, -2));
    forms.push(w.slice(0, -1));
  }
  if (w.endsWith('ing') && w.length > 5) {
    forms.push(w.slice(0, -3));
    forms.push(w.slice(0, -3) + 'e');
    forms.push(w.slice(0, -4));
  }
  if (w.endsWith('ly') && w.length > 4) forms.push(w.slice(0, -2));
  if (w.endsWith('tion')) forms.push(w.slice(0, -4) + 'te');
  if (w.endsWith('ment') && w.length > 5) forms.push(w.slice(0, -4));
  if (w.endsWith('ness') && w.length > 5) forms.push(w.slice(0, -4));
  if (w.endsWith('able') && w.length > 5) forms.push(w.slice(0, -4));
  if (w.endsWith('ful') && w.length > 4) forms.push(w.slice(0, -3));
  return [...new Set(forms.map(normalizeWord).filter(Boolean))];
}

function offlineChineseSenses(entry) {
  const quality = text(entry?.quality).toLowerCase();
  if (!['high', 'screened'].includes(quality)) return [];
  return (entry.senses || [])
    .filter(sense => sense?.quality === quality && text(sense.glossZh))
    .map(sense => ({ pos: text(sense.pos), glossZh: text(sense.glossZh) }));
}

function offlineChineseSense(entry) {
  return offlineChineseSenses(entry)[0] || null;
}

function limitedDefinition(entry) {
  return (entry?.senses || []).find(sense => text(sense?.definitionEn))?.definitionEn || '';
}

function firstPos(entry) {
  return text(offlineChineseSense(entry)?.pos || entry?.senses?.find(sense => text(sense?.pos))?.pos);
}

function readExamLevels(entry) {
  const values = Array.isArray(entry?.layers?.examFocus)
    ? entry.layers.examFocus
    : entry?.layers?.examFocus ? [entry.layers.examFocus] : [];
  return [...new Set(values.flatMap(value => {
    if (!isRecord(value)) return [];
    if (Array.isArray(value.tracks)) return value.tracks.map(text).filter(Boolean);
    return [text(value.track || value.level)].filter(Boolean);
  }))];
}

function frequencyLevel(entry) {
  const values = Array.isArray(entry?.layers?.frequency)
    ? entry.layers.frequency
    : entry?.layers?.frequency ? [entry.layers.frequency] : [];
  const band = text(values[0]?.band).toLocaleLowerCase('en-US');
  if (band === 'ngsl-1' || band === 'ngsl-2') return 'high';
  if (band === 'ngsl-3' || band === 'ngsl-4' || entry?.layers?.academic) return 'medium';
  return 'unknown';
}

function lexiconMetadata(entry) {
  return {
    examLevels: readExamLevels(entry),
    freqLevel: frequencyLevel(entry),
    lexiconVersion: text(entry?.lexiconVersion),
    sourceRefs: Array.isArray(entry?.sourceRefs) ? entry.sourceRefs.filter(value => text(value)) : []
  };
}

async function fetchOnlineDefinition(fetchFn, key) {
  if (typeof fetchFn !== 'function') return null;
  try {
    const response = await fetchFn(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`);
    if (!response?.ok) return null;
    const payload = await response.json();
    const entry = Array.isArray(payload) ? payload[0] : null;
    if (!isRecord(entry)) return null;
    const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
    const preferredAudio = phonetics.find(value => text(value?.audio) && /-(?:us|uk)/i.test(value.audio))
      || phonetics.find(value => text(value?.audio));
    const meaning = Array.isArray(entry.meanings) ? entry.meanings[0] : null;
    const definition = Array.isArray(meaning?.definitions) ? text(meaning.definitions[0]?.definition) : '';
    return {
      phonetic: text(entry.phonetic || phonetics.find(value => text(value?.text))?.text),
      audioUrl: text(preferredAudio?.audio),
      pos: text(meaning?.partOfSpeech),
      definitionEn: definition
    };
  } catch {
    return null;
  }
}

async function translateSafely(translateWord, key) {
  if (typeof translateWord !== 'function') return '';
  try {
    const translated = text(await translateWord(key));
    return CHINESE_TEXT.test(translated) ? translated : '';
  } catch {
    return '';
  }
}

export function createDictionary({
  lexiconLoader = createLexiconLoader(),
  oewnLoader = createOewnDefinitionLoader(),
  fetchFn = globalThis.fetch,
  translateWord = word => API.translateWord(word),
  cacheMax = 500
} = {}) {
  if (!lexiconLoader || typeof lexiconLoader.loadCore !== 'function' || typeof lexiconLoader.lookup !== 'function') {
    throw new TypeError('词典需要可验证的词库加载器');
  }
  if (!oewnLoader || typeof oewnLoader.lookup !== 'function') {
    throw new TypeError('词典需要可验证的 OEWN 英文义项加载器');
  }

  return {
    core: null,
    cache: new Map(),
    CACHE_MAX: Math.max(1, Number.parseInt(cacheMax, 10) || 500),

    async load() {
      if (this.core) return this.core;
      try {
        this.core = await lexiconLoader.loadCore();
      } catch {
        this.core = null;
      }
      return this.core;
    },

    // Compatibility for older callers. Exam metadata now comes only from an
    // auditable `examFocus` layer in the same core artifact.
    async loadExamData() {
      return this.load();
    },

    getStemForms,

    setCache(key, value) {
      if (this.cache.has(key)) this.cache.delete(key);
      while (this.cache.size >= this.CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, value);
    },

    getExamData(word, entry = null) {
      return lexiconMetadata(entry || { lemma: word, layers: {}, sourceRefs: [] });
    },

    async lookup(word) {
      const key = normalizeWord(word);
      if (!key || (key.length < 2 && key !== 'a')) {
        return { word, phonetic: '', translation: '无效单词', found: false, source: 'invalid' };
      }
      if (this.cache.has(key)) return this.cache.get(key);

      await this.load();
      let localEntry = null;
      let isDeclaredFormMatch = false;
      for (const [index, form] of this.getStemForms(key).entries()) {
        try {
          localEntry = await lexiconLoader.lookup(form);
        } catch {
          localEntry = null;
        }
        if (localEntry) {
          // A high-quality Chinese gloss is only authoritative when the
          // queried surface form exists in the shipped core.  Later forms are
          // local heuristics for finding an online/limited fallback, not a
          // license to reuse the base lemma's gloss.
          isDeclaredFormMatch = index === 0;
          break;
        }
      }

      const metadata = this.getExamData(key, localEntry);
      const offlineSense = isDeclaredFormMatch ? offlineChineseSense(localEntry) : null;
      if (offlineSense) {
        const result = {
          word: key,
          baseForm: localEntry.lemma !== key ? localEntry.lemma : undefined,
          phonetic: text(localEntry.phonetic),
          translation: offlineSense.glossZh,
          definitionEn: text(offlineSense.definitionEn),
          pos: text(offlineSense.pos),
          senses: offlineChineseSenses(localEntry),
          audioUrl: AUDIO_URL(key),
          found: true,
          definitionQuality: localEntry.quality,
          source: `lexicon-${localEntry.quality}`,
          ...metadata
        };
        this.setCache(key, result);
        return result;
      }

      let oewnDefinition = null;
      if (localEntry?.quality === 'limited') {
        try {
          oewnDefinition = await oewnLoader.lookup({
            lemma: localEntry.lemma,
            pos: firstPos(localEntry),
            coreLexiconVersion: this.core?.lexiconVersion
          });
        } catch {
          // A corrupt/mismatched OEWN derivative must never block normal
          // online lookup or be treated as a trusted Chinese translation.
          oewnDefinition = null;
        }
      }

      const online = await fetchOnlineDefinition(fetchFn, key);
      const translated = await translateSafely(translateWord, key);
      const definitionEn = text(oewnDefinition?.definitionEn || online?.definitionEn || limitedDefinition(localEntry));
      const isLimited = Boolean(localEntry);
      const resolvedPos = text(online?.pos || oewnDefinition?.pos || firstPos(localEntry));
      const translation = translated || (definitionEn ? `英文释义：${definitionEn}` : '暂时无法获取可靠释义');
      const result = {
        word: key,
        baseForm: localEntry?.lemma && localEntry.lemma !== key ? localEntry.lemma : undefined,
        phonetic: text(online?.phonetic),
        translation,
        definitionEn,
        pos: resolvedPos,
        senses: translated ? [{ pos: resolvedPos, glossZh: translated }] : [],
        audioUrl: text(online?.audioUrl || AUDIO_URL(key)),
        found: Boolean(translated || definitionEn || isLimited),
        definitionQuality: isLimited ? 'limited' : 'unavailable',
        source: translated
          ? (isLimited ? 'lexicon-limited-ai' : 'ai')
          : (isLimited ? (oewnDefinition ? 'lexicon-limited-oewn' : online ? 'lexicon-limited-api' : 'lexicon-limited') : online ? 'api' : 'unavailable'),
        ...metadata
      };
      this.setCache(key, result);
      return result;
    }
  };
}

export const Dictionary = createDictionary();
