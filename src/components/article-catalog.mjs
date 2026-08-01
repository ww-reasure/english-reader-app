export const ARTICLE_CATALOG_KEY = 'cloud-main';
export const ARTICLE_CATALOG_SCHEMA_VERSION = 1;
export const ARTICLE_CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
export const ARTICLE_CATALOG_CHECK_INTERVAL_MS = 10 * 60 * 1000;

const CATALOG_FIELDS = [
  'id',
  'title',
  'titleZh',
  'source',
  'sourceUrl',
  'url',
  'sourceType',
  'difficulty',
  'targetTrack',
  'examType',
  'examTypeConfidence',
  'examYear',
  'examName',
  'examText',
  'examTopic',
  'articleGenre',
  'topicConfidence',
  'genreConfidence',
  'classificationConfidence',
  'classificationVersion',
  'classificationSource',
  'classifiedAt',
  'wordCount',
  'publishedAt',
  'createdAt',
  'summary',
  'tags',
  'category',
  'tracks',
  'difficultyScore'
];

function sanitizeArticle(article) {
  if (!article || typeof article !== 'object' || Array.isArray(article)) return null;
  const safe = {};
  for (const key of CATALOG_FIELDS) {
    if (article[key] !== undefined) safe[key] = article[key];
  }
  if (safe.id === undefined && !safe.sourceUrl && !safe.url) return null;
  return safe;
}

function sanitizeArticles(articles) {
  if (!Array.isArray(articles)) return null;
  return articles.map(sanitizeArticle).filter(Boolean);
}

function signatureFor(articles) {
  return JSON.stringify(articles);
}

function validateSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.key !== ARTICLE_CATALOG_KEY
    || value.schemaVersion !== ARTICLE_CATALOG_SCHEMA_VERSION
    || !Number.isFinite(Number(value.fetchedAt))) return null;
  const articles = sanitizeArticles(value.articles);
  if (!articles) return null;
  return {
    key: ARTICLE_CATALOG_KEY,
    schemaVersion: ARTICLE_CATALOG_SCHEMA_VERSION,
    fetchedAt: Number(value.fetchedAt),
    lastCheckedAt: Number.isFinite(Number(value.lastCheckedAt))
      ? Number(value.lastCheckedAt)
      : null,
    signature: String(value.signature || signatureFor(articles)),
    articles
  };
}

export function createArticleCatalog({
  repository,
  fetchCatalog,
  now = () => Date.now(),
  ttlMs = ARTICLE_CATALOG_TTL_MS,
  checkIntervalMs = ARTICLE_CATALOG_CHECK_INTERVAL_MS
} = {}) {
  if (!repository?.getArticleCatalog || !repository?.saveArticleCatalog) {
    throw new TypeError('ArticleCatalog requires a catalog repository');
  }
  if (typeof fetchCatalog !== 'function') {
    throw new TypeError('ArticleCatalog requires a catalog fetcher');
  }

  let snapshot = null;
  let memoryLoaded = false;
  let loadPromise = null;
  let refreshPromise = null;
  let queuedForce = false;
  const subscribers = new Set();

  const isFresh = value => Boolean(value)
    && Math.max(0, Number(now()) - Number(value.fetchedAt)) < ttlMs;
  const wasRecentlyChecked = value => Boolean(value)
    && Number.isFinite(Number(value.lastCheckedAt))
    && Math.max(0, Number(now()) - Number(value.lastCheckedAt)) < checkIntervalMs;

  async function getSnapshot() {
    if (memoryLoaded) return snapshot;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        snapshot = validateSnapshot(await repository.getArticleCatalog(ARTICLE_CATALOG_KEY));
      } catch {
        snapshot = null;
      } finally {
        memoryLoaded = true;
        loadPromise = null;
      }
      return snapshot;
    })();
    return loadPromise;
  }

  async function performRefresh(force) {
    const previous = await getSnapshot();
    if (!force && wasRecentlyChecked(previous)) {
      return { snapshot: previous, source: 'cache', refreshed: false, changed: false };
    }

    try {
      const fetched = sanitizeArticles(await fetchCatalog());
      if (!fetched) throw new TypeError('文章目录响应格式无效');
      const signature = signatureFor(fetched);
      const next = {
        key: ARTICLE_CATALOG_KEY,
        schemaVersion: ARTICLE_CATALOG_SCHEMA_VERSION,
        fetchedAt: Number(now()),
        lastCheckedAt: Number(now()),
        signature,
        articles: fetched
      };
      await repository.saveArticleCatalog(next);
      snapshot = next;
      memoryLoaded = true;
      const changed = Boolean(previous) && previous.signature !== signature;
      if (changed) {
        const event = { previous, snapshot: next };
        subscribers.forEach(listener => {
          try { listener(event); } catch {}
        });
      }
      return { snapshot: next, source: 'network', refreshed: true, changed };
    } catch (error) {
      if (previous) {
        return { snapshot: previous, source: 'cache', refreshed: false, changed: false, error };
      }
      throw error;
    }
  }

  function refresh({ force = false } = {}) {
    if (refreshPromise) {
      if (force) queuedForce = true;
      return refreshPromise;
    }
    refreshPromise = (async () => {
      let result = await performRefresh(force);
      while (queuedForce) {
        queuedForce = false;
        result = await performRefresh(true);
      }
      return result;
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function prewarm() {
    await getSnapshot();
    return refresh();
  }

  async function findCurrentArticle({ id = '', sourceUrl = '', url = '' } = {}) {
    const current = await getSnapshot();
    if (!current) return null;
    const stableUrl = String(sourceUrl || url || '').trim();
    if (stableUrl) {
      const byUrl = current.articles.find(article =>
        String(article.sourceUrl || article.url || '').trim() === stableUrl
      );
      if (byUrl) return byUrl;
    }
    const stableId = String(id || '').trim();
    return stableId
      ? current.articles.find(article => String(article.id || '').trim() === stableId) || null
      : null;
  }

  async function removeArticle({ id = '', sourceUrl = '', url = '' } = {}) {
    const current = await getSnapshot();
    if (!current) return false;
    const stableId = String(id || '').trim();
    const stableUrl = String(sourceUrl || url || '').trim();
    const articles = current.articles.filter(article => {
      if (stableId && String(article.id || '').trim() === stableId) return false;
      if (stableUrl && String(article.sourceUrl || article.url || '').trim() === stableUrl) return false;
      return true;
    });
    if (articles.length === current.articles.length) return false;
    const next = {
      ...current,
      signature: signatureFor(articles),
      articles
    };
    await repository.saveArticleCatalog(next);
    snapshot = next;
    memoryLoaded = true;
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  return {
    getSnapshot,
    refresh,
    prewarm,
    findCurrentArticle,
    removeArticle,
    subscribe,
    isFresh
  };
}

export const ArticleCatalogCore = Object.freeze({
  createArticleCatalog,
  ARTICLE_CATALOG_KEY,
  ARTICLE_CATALOG_SCHEMA_VERSION,
  ARTICLE_CATALOG_TTL_MS,
  ARTICLE_CATALOG_CHECK_INTERVAL_MS
});
