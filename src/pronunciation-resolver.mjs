const WORD_PATTERN = /[^a-z'-]/gu;
const AUDIO_EXTENSION = /\.(?:flac|m4a|mp3|oga|ogg|wav|webm)$/iu;
const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php';
const FREE_DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

const text = value => String(value || '').trim();

export function normalizePronunciationWord(value) {
  return text(value).toLocaleLowerCase('en-US').replace(WORD_PATTERN, '');
}

function normalizeHttpsUrl(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#0*39;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&nbsp;/giu, ' ');
}

function plainMetadataText(value) {
  return decodeEntities(text(value).replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ')).trim();
}

function inferAccent(...values) {
  const joined = values.map(value => text(value).toLocaleLowerCase('en-US')).join(' ');
  if (/(?:^|[^a-z])(?:en[-_ ]?(?:us|usa)|us)(?:[^a-z]|$)|_us_/u.test(joined)) return 'us';
  if (/(?:^|[^a-z])(?:en[-_ ]?(?:uk|gb)|uk|british)(?:[^a-z]|$)|_gb_/u.test(joined)) return 'uk';
  if (/(?:^|[^a-z])(?:en[-_ ]?au|au|australian)(?:[^a-z]|$)|_au_/u.test(joined)) return 'au';
  return 'other';
}

function sortByAccent(candidates, preferredAccent) {
  const preferred = ['uk', 'us', 'au'].includes(preferredAccent) ? preferredAccent : 'uk';
  const order = [preferred, ...['uk', 'us', 'au'].filter(value => value !== preferred), 'other'];
  return candidates.sort((left, right) => order.indexOf(left.accent) - order.indexOf(right.accent));
}

function uniqueByUrl(candidates) {
  const seen = new Set();
  return candidates.filter(candidate => {
    if (!candidate.url || seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

async function runWithSourceTimeout(operation, externalSignal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abort);
  }
}

export async function fetchPronunciationResponse(url, {
  fetchFn = globalThis.fetch,
  signal = null,
  timeoutMs = 3500
} = {}) {
  const safeUrl = normalizeHttpsUrl(url);
  if (!safeUrl || typeof fetchFn !== 'function' || signal?.aborted) return null;
  try {
    return await runWithSourceTimeout(async sourceSignal => {
      const response = await fetchFn(safeUrl, { signal: sourceSignal });
      return response?.ok ? response : null;
    }, signal, Math.max(10, Number.parseInt(timeoutMs, 10) || 3500));
  } catch {
    return null;
  }
}

export async function resolveFreeDictionaryPronunciations({
  word,
  fetchFn = globalThis.fetch,
  signal = null,
  preferredAccent = 'uk'
} = {}) {
  const key = normalizePronunciationWord(word);
  if (!key || typeof fetchFn !== 'function' || signal?.aborted) return [];

  try {
    const response = await fetchFn(`${FREE_DICTIONARY_API}${encodeURIComponent(key)}`, {
      signal,
      headers: { Accept: 'application/json' }
    });
    if (!response?.ok || signal?.aborted) return [];
    const payload = await response.json();
    const entries = Array.isArray(payload) ? payload : [];
    const candidates = [];

    for (const entry of entries) {
      if (normalizePronunciationWord(entry?.word) !== key) continue;
      const entryLicense = entry?.license || {};
      const entrySourceUrl = Array.isArray(entry?.sourceUrls) ? entry.sourceUrls[0] : '';
      for (const phonetic of Array.isArray(entry?.phonetics) ? entry.phonetics : []) {
        const url = normalizeHttpsUrl(phonetic?.audio);
        if (!url) continue;
        const license = phonetic?.license || entryLicense;
        candidates.push({
          word: key,
          url,
          source: 'free-dictionary',
          accent: inferAccent(phonetic?.type, phonetic?.accent, url),
          phonetic: text(phonetic?.text),
          sourceUrl: normalizeHttpsUrl(phonetic?.sourceUrl || entrySourceUrl),
          licenseName: text(license?.name),
          licenseUrl: normalizeHttpsUrl(license?.url),
          author: '',
          attributionRequired: Boolean(text(license?.name) || text(phonetic?.sourceUrl || entrySourceUrl)),
          mimeType: url.toLocaleLowerCase('en-US').endsWith('.mp3') ? 'audio/mpeg' : ''
        });
      }
    }

    return sortByAccent(uniqueByUrl(candidates), preferredAccent);
  } catch {
    return [];
  }
}

function wikimediaSearchUrl(word) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `intitle:${word.replace(/"/gu, '')} incategory:"Lingua Libre pronunciation-eng"`,
    gsrnamespace: '6',
    gsrlimit: '20',
    prop: 'imageinfo',
    iiprop: 'url|mime|mediatype|extmetadata',
    format: 'json',
    formatversion: '2',
    origin: '*'
  });
  return `${WIKIMEDIA_API}?${params}`;
}

function exactWikimediaRecording(title, word) {
  const decoded = text(title).replace(/^File:/iu, '').replace(/_/gu, ' ');
  if (!AUDIO_EXTENSION.test(decoded)) return false;
  const stem = decoded.replace(AUDIO_EXTENSION, '').toLocaleLowerCase('en-US');
  return stem === word || stem.endsWith(`-${word}`);
}

function metadataValue(metadata, key) {
  return metadata?.[key]?.value ?? '';
}

export async function resolveWikimediaPronunciations({
  word,
  fetchFn = globalThis.fetch,
  signal = null,
  preferredAccent = 'uk'
} = {}) {
  const key = normalizePronunciationWord(word);
  if (!key || typeof fetchFn !== 'function' || signal?.aborted) return [];

  try {
    const response = await fetchFn(wikimediaSearchUrl(key), {
      signal,
      headers: {
        Accept: 'application/json',
        'Api-User-Agent': 'EnglishReader/2.0 (private learning app)'
      }
    });
    if (!response?.ok || signal?.aborted) return [];
    const payload = await response.json();
    const rawPages = payload?.query?.pages;
    const pages = Array.isArray(rawPages) ? rawPages : rawPages && typeof rawPages === 'object' ? Object.values(rawPages) : [];
    const candidates = [];

    for (const page of pages) {
      if (!exactWikimediaRecording(page?.title, key)) continue;
      const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
      const url = normalizeHttpsUrl(info?.url);
      if (!url) continue;
      const metadata = info?.extmetadata || {};
      const attribution = text(metadataValue(metadata, 'AttributionRequired')).toLocaleLowerCase('en-US');
      candidates.push({
        word: key,
        url,
        source: 'wikimedia-commons',
        accent: inferAccent(page?.title, metadataValue(metadata, 'Language'), metadataValue(metadata, 'ImageDescription')),
        phonetic: plainMetadataText(metadataValue(metadata, 'IPA')),
        sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(text(page.title))}`,
        licenseName: plainMetadataText(metadataValue(metadata, 'LicenseShortName')),
        licenseUrl: normalizeHttpsUrl(metadataValue(metadata, 'LicenseUrl')),
        author: plainMetadataText(metadataValue(metadata, 'Artist') || metadataValue(metadata, 'Credit')),
        attributionRequired: attribution === 'true',
        mimeType: text(info?.mime)
      });
    }

    return sortByAccent(uniqueByUrl(candidates), preferredAccent);
  } catch {
    return [];
  }
}

export function createPronunciationResolver({
  fetchFn = globalThis.fetch,
  preferredAccent = 'uk',
  sourceTimeoutMs = 4500
} = {}) {
  const timeoutMs = Math.max(10, Number.parseInt(sourceTimeoutMs, 10) || 4500);
  const resolveWikimedia = (word, { signal = null } = {}) => runWithSourceTimeout(
    sourceSignal => resolveWikimediaPronunciations({ word, fetchFn, signal: sourceSignal, preferredAccent }),
    signal,
    timeoutMs
  );
  return {
    async resolve(word, { signal = null, includeWikimedia = true } = {}) {
      const dictionary = await runWithSourceTimeout(
        sourceSignal => resolveFreeDictionaryPronunciations({ word, fetchFn, signal: sourceSignal, preferredAccent }),
        signal,
        timeoutMs
      );
      if (dictionary.length || signal?.aborted || !includeWikimedia) return dictionary;
      return resolveWikimedia(word, { signal });
    },
    resolveWikimedia
  };
}
