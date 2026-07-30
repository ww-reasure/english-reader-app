import { ARTICLE_SERVER_URL } from '../config.js';
import { DB } from '../db.js';
import { createArticleCatalog } from './article-catalog.mjs';

async function fetchCloudCatalog() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${ARTICLE_SERVER_URL}/api/articles?limit=500`, {
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export const ArticleCatalog = createArticleCatalog({
  repository: {
    getArticleCatalog: key => DB.getArticleCatalog(key),
    saveArticleCatalog: record => DB.saveArticleCatalog(record)
  },
  fetchCatalog: fetchCloudCatalog
});

export { ARTICLE_CATALOG_TTL_MS } from './article-catalog.mjs';
