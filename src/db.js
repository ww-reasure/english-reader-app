/**
 * Database Module
 * Handles IndexedDB operations for articles, vocabulary, and learn words
 */

import { getStemForm } from './helpers.js';

export const DB = {
  DB_NAME: 'EnglishReader',
  DB_VERSION: 6,  // Bumped for RSS article support

  // Open database connection with retry
  open(retries = 3) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('articles')) {
          const store = db.createObjectStore('articles', { keyPath: 'id', autoIncrement: true });
          store.createIndex('createdAt', 'createdAt');
        }

        if (!db.objectStoreNames.contains('vocabulary')) {
          const store = db.createObjectStore('vocabulary', { keyPath: 'id', autoIncrement: true });
          store.createIndex('word', 'word');
        }

        if (!db.objectStoreNames.contains('learnWords')) {
          const store = db.createObjectStore('learnWords', { keyPath: 'id', autoIncrement: true });
          store.createIndex('word', 'word', { unique: true });
          store.createIndex('createdAt', 'createdAt');
          store.createIndex('nextReview', 'nextReview');
        }

        if (e.oldVersion < 3) {
          const store = e.target.transaction.objectStore('learnWords');
          if (!store.indexNames.contains('nextReview')) {
            store.createIndex('nextReview', 'nextReview');
          }
        }

        // v4: add favorite index to articles
        if (e.oldVersion < 4) {
          try {
            const store = e.target.transaction.objectStore('articles');
            if (!store.indexNames.contains('favorite')) {
              store.createIndex('favorite', 'favorite');
            }
          } catch {}
        }

        // v5: readingStats table
        if (!db.objectStoreNames.contains('readingStats')) {
          const store = db.createObjectStore('readingStats', { keyPath: 'id', autoIncrement: true });
          store.createIndex('createdAt', 'createdAt');
        }

        // v6: add fields for RSS articles
        if (e.oldVersion < 6) {
          const store = e.target.transaction.objectStore('articles');
          if (!store.indexNames.contains('source')) {
            store.createIndex('source', 'source');
          }
          if (!store.indexNames.contains('sourceType')) {
            store.createIndex('sourceType', 'sourceType');
          }
          if (!store.indexNames.contains('url')) {
            store.createIndex('url', 'url', { unique: false });
          }
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        if (retries > 1) {
          setTimeout(() => this.open(retries - 1).then(resolve).catch(reject), 100);
        } else {
          reject(req.error);
        }
      };
    });
  },

  // ===== Articles =====

  async saveArticle(article) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('articles', 'readwrite');
      const store = tx.objectStore('articles');
      const req = store.add({ ...article, createdAt: Date.now() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getArticle(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('articles', 'readonly');
      const req = tx.objectStore('articles').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllArticles() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('articles', 'readonly');
      const req = tx.objectStore('articles').getAll();
      req.onsuccess = () => resolve(req.result.reverse());
      req.onerror = () => reject(req.error);
    });
  },

  // Update article fields (e.g., favorite)
  async updateArticle(id, fields) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('articles', 'readwrite');
      const store = tx.objectStore('articles');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const article = getReq.result;
        if (article) {
          Object.assign(article, fields);
          store.put(article);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // Get favorite articles
  async getFavoriteArticles() {
    const articles = await this.getAllArticles();
    return articles.filter(a => a.favorite);
  },

  // Sync a server article to IndexedDB (dedup by URL)
  async syncArticle(serverArticle) {
    // Support both 'url' and 'sourceUrl' field names
    const articleUrl = serverArticle.url || serverArticle.sourceUrl || '';
    const newContent = (serverArticle.content || '').trim();
    // Check if already exists by URL
    const existing = await this.findArticleByUrl(articleUrl);

    // 已有本地记录: 若本地 content 为空而云端有全文, 补写全文
    if (existing) {
      const localEmpty = !(existing.content && existing.content.trim());
      if (localEmpty && newContent) {
        const db = await this.open();
        await new Promise((resolve, reject) => {
          const tx = db.transaction('articles', 'readwrite');
          tx.objectStore('articles').put({
            ...existing,
            content: serverArticle.content,
            summary: serverArticle.summary || existing.summary || '',
            difficulty: serverArticle.difficulty || existing.difficulty,
            wordCount: serverArticle.wordCount || existing.wordCount,
            titleZh: serverArticle.titleZh || existing.titleZh || ''
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
      return existing.id;
    }

    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('articles', 'readwrite');
      const req = tx.objectStore('articles').add({
        title: serverArticle.title,
        titleZh: serverArticle.titleZh || '',
        content: serverArticle.content,
        translation: '',
        difficulty: serverArticle.difficulty || 'cet4',
        wordCount: serverArticle.wordCount || 0,
        topic: serverArticle.source || 'reading',
        source: serverArticle.source || '',
        sourceType: 'rss',
        url: articleUrl,
        publishedAt: serverArticle.publishedAt || Date.now(),
        summary: serverArticle.summary || '',
        tags: serverArticle.tags || [],
        // 云端分段在修时可能返回空 content, 标记 partial 供阅读页提示
        partial: newContent ? 0 : 1,
        favorite: 0,
        createdAt: Date.now()
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // Find article by URL
  async findArticleByUrl(url) {
    if (!url) return null;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('articles', 'readonly');
      const store = tx.objectStore('articles');
      const index = store.index('url');
      const req = index.get(url);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async deleteArticle(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('articles', 'readwrite');
      tx.objectStore('articles').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // ===== Vocabulary (saved during reading) =====

  async saveWord(wordData) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('vocabulary', 'readwrite');
      const req = tx.objectStore('vocabulary').add({ ...wordData, createdAt: Date.now() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllWords() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('vocabulary', 'readonly');
      const req = tx.objectStore('vocabulary').getAll();
      req.onsuccess = () => resolve(req.result.reverse());
      req.onerror = () => reject(req.error);
    });
  },

  async deleteWord(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('vocabulary', 'readwrite');
      tx.objectStore('vocabulary').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // ===== Learn Words (imported for review) =====
  // Words are stored in stem form for deduplication (e.g., running → run)

  async saveLearnWord(wordData) {
    const stemWord = getStemForm(wordData.word);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('learnWords', 'readwrite');
      const req = tx.objectStore('learnWords').add({ ...wordData, word: stemWord, createdAt: Date.now() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // Check if a word already exists in learnWords
  async findLearnWord(word) {
    const stemWord = getStemForm(word);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('learnWords', 'readonly');
      const req = tx.objectStore('learnWords').index('word').get(stemWord);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllLearnWords() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('learnWords', 'readonly');
      const req = tx.objectStore('learnWords').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async deleteLearnWord(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('learnWords', 'readwrite');
      tx.objectStore('learnWords').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // Update SRS fields for a learn word
  async updateLearnWordSRS(id, srsData) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('learnWords', 'readwrite');
      const store = tx.objectStore('learnWords');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const word = getReq.result;
        if (word) {
          Object.assign(word, srsData);
          store.put(word);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async clearLearnWords() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('learnWords', 'readwrite');
      tx.objectStore('learnWords').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // ===== Reading Stats =====

  async saveReadingStat(stat) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('readingStats', 'readwrite');
      const req = tx.objectStore('readingStats').add({ ...stat, createdAt: Date.now() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllReadingStats() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('readingStats', 'readonly');
      const req = tx.objectStore('readingStats').getAll();
      req.onsuccess = () => resolve(req.result.reverse());
      req.onerror = () => reject(req.error);
    });
  },

  async getAverageWPM() {
    const stats = await this.getAllReadingStats();
    if (stats.length === 0) return 0;
    return Math.round(stats.reduce((sum, s) => sum + s.wpm, 0) / stats.length);
  }
};
