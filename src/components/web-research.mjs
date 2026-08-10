/**
 * Web Research
 * Optional Tavily-backed search used by the home agent to research recent
 * news or external facts. The service owns provider details, result
 * validation, bounded caching and graceful degradation so callers never
 * receive fabricated links or a thrown network error.
 */

export const WEB_RESEARCH_SERVICE = 'tavily';
export const WEB_RESEARCH_MAX_SOURCES = 5;

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const REQUEST_TIMEOUT_MS = 20000;
const RECENCY_FRESH_MS = 15 * 60 * 1000;
const GENERAL_FRESH_MS = 24 * 60 * 60 * 1000;
const MAX_QUERY_LENGTH = 500;
const MAX_SNIPPET_LENGTH = 240;
const MAX_TITLE_LENGTH = 160;
const MAX_BRIEF_LENGTH = 1200;

const normalizeSpace = value => String(value || '').replace(/\s+/g, ' ').trim();
const hostnameOf = url => {
  try {
    return String(new URL(url).hostname || '').replace(/^www\./, '');
  } catch {
    return '';
  }
};

export function normalizeResearchSource(value = {}) {
  if (!value || typeof value !== 'object') return null;
  const url = String(value.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const hostname = hostnameOf(url);
  if (!hostname) return null;
  const publishedAt = String(value.publishedAt || value.published_date || '').trim().slice(0, 40);
  const snippet = normalizeSpace(value.snippet ?? value.content ?? '').slice(0, MAX_SNIPPET_LENGTH);
  return {
    title: normalizeSpace(value.title).slice(0, MAX_TITLE_LENGTH) || hostname,
    url,
    domain: normalizeSpace(value.domain).slice(0, 120) || hostname,
    ...(publishedAt ? { publishedAt } : {}),
    ...(snippet ? { snippet } : {})
  };
}

export function normalizeResearchSources(value) {
  const seen = new Set();
  const rows = [];
  for (const candidate of Array.isArray(value) ? value : []) {
    if (rows.length >= WEB_RESEARCH_MAX_SOURCES) break;
    const source = normalizeResearchSource(candidate);
    if (!source || seen.has(source.url)) continue;
    seen.add(source.url);
    rows.push(source);
  }
  return rows;
}

export function buildResearchBrief({ query = '', sources = [], limit = MAX_BRIEF_LENGTH } = {}) {
  const cleanSources = normalizeResearchSources(sources);
  const lines = [
    `联网检索主题：${normalizeSpace(query).slice(0, 120) || '未指定'}`,
    ...cleanSources.map((source, index) => {
      const when = source.publishedAt ? `（${source.publishedAt}）` : '';
      const snippet = source.snippet ? `摘要：${source.snippet}` : '';
      return `${index + 1}. ${source.domain}${when}《${source.title}》${snippet ? ` ${snippet}` : ''}`;
    })
  ];
  return lines.join('\n').slice(0, Math.max(1, Number(limit) || MAX_BRIEF_LENGTH));
}

export function createWebResearch({
  config = { get: () => '' },
  fetchImpl = null,
  storage = null,
  now = () => Date.now(),
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const memoryCache = new Map();
  const inflight = new Map();

  const apiKey = () => String(config.get('tavily_api_key') || '').trim();

  const cacheKeyOf = ({ query, recencyDays, domains = [] }) => [
    WEB_RESEARCH_SERVICE,
    normalizeSpace(query).toLocaleLowerCase('en-US'),
    Number(recencyDays) > 0 ? `d${Number(recencyDays)}` : '',
    ...domains.map(domain => normalizeSpace(domain).toLocaleLowerCase('en-US'))
  ].filter(Boolean).join('|');

  const readPersisted = key => {
    try {
      const raw = storage?.getItem?.(`web_research:${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const writePersisted = (key, record) => {
    try {
      storage?.setItem?.(`web_research:${key}`, JSON.stringify(record));
    } catch {
      // Caching is best effort; a full store never blocks a search.
    }
  };

  const freshTtlFor = recencyDays => (
    Number(recencyDays) > 0 && Number(recencyDays) <= 7 ? RECENCY_FRESH_MS : GENERAL_FRESH_MS
  );

  async function performSearch({ query, recencyDays, domains = [] }, signal) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) return { status: 'cancelled', query, sources: [] };
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = {
        api_key: apiKey(),
        query: query.slice(0, MAX_QUERY_LENGTH),
        max_results: WEB_RESEARCH_MAX_SOURCES,
        search_depth: Number(recencyDays) > 0 ? 'advanced' : 'basic',
        include_answer: false,
        include_raw_content: false,
        ...(Number(recencyDays) > 0 ? { days: Math.min(30, Math.max(1, Number(recencyDays) || 1)) } : {}),
        ...(domains.length ? { include_domains: domains.slice(0, WEB_RESEARCH_MAX_SOURCES) } : {})
      };
      const response = await doFetch(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (controller.signal.aborted || signal?.aborted) return { status: 'cancelled', query, sources: [] };
      if (!response.ok) return { status: 'error', reason: `http_${response.status}`, query, sources: [] };
      const data = await response.json().catch(() => null);
      if (controller.signal.aborted || signal?.aborted) return { status: 'cancelled', query, sources: [] };
      const rawResults = Array.isArray(data?.results) ? data.results : [];
      const sources = normalizeResearchSources(rawResults);
      if (!sources.length) return { status: 'no_results', query, sources: [] };
      return {
        status: 'ok',
        query,
        recencyDays: Number(recencyDays) || 0,
        searchedAt: now(),
        service: WEB_RESEARCH_SERVICE,
        sources,
        truncated: rawResults.length > sources.length
      };
    } catch (error) {
      if (controller.signal.aborted || signal?.aborted) return { status: 'cancelled', query, sources: [] };
      return { status: 'error', reason: 'network', query, sources: [] };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  async function search(input = {}) {
    const query = normalizeSpace(input.query);
    if (!apiKey()) return { status: 'missing_key', query, sources: [] };
    if (!query) return { status: 'invalid_query', query, sources: [] };
    const recencyDays = Number(input.recencyDays) || 0;
    const domains = Array.isArray(input.domains)
      ? input.domains.map(domain => String(domain).trim()).filter(Boolean).slice(0, WEB_RESEARCH_MAX_SOURCES)
      : [];
    const cacheKey = cacheKeyOf({ query, recencyDays, domains });
    const signal = input.signal || null;
    const remembered = readPersisted(cacheKey) || memoryCache.get(cacheKey) || null;
    const freshTtl = freshTtlFor(recencyDays);

    if (remembered && now() - Number(remembered.searchedAt || 0) < freshTtl) {
      memoryCache.set(cacheKey, remembered);
      return { ...remembered, cached: true };
    }

    if (remembered) {
      // Serve the stale snapshot immediately while one background refresh
      // keeps the cache fresh, so an old "latest news" is never presented
      // as newly checked.
      if (!inflight.has(cacheKey)) {
        const refreshing = performSearch({ query, recencyDays, domains }, null)
          .then(record => {
            if (record.status === 'ok') {
              memoryCache.set(cacheKey, record);
              writePersisted(cacheKey, record);
            }
            return record;
          })
          .catch(() => null)
          .finally(() => inflight.delete(cacheKey));
        inflight.set(cacheKey, refreshing);
      }
      return { ...remembered, cached: true, stale: true };
    }

    if (inflight.has(cacheKey)) return inflight.get(cacheKey);
    const pending = performSearch({ query, recencyDays, domains }, signal)
      .then(record => {
        if (record.status === 'ok') {
          memoryCache.set(cacheKey, record);
          writePersisted(cacheKey, record);
        }
        return record;
      })
      .finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, pending);
    return pending;
  }

  async function testConnection() {
    if (!apiKey()) return { ok: false, reason: 'missing_key' };
    const result = await performSearch({ query: 'connectivity test', recencyDays: 0 }, null);
    return result.status === 'ok' ? { ok: true } : { ok: false, reason: result.reason || result.status };
  }

  return {
    hasKey: () => Boolean(apiKey()),
    search,
    testConnection
  };
}