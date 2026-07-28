/**
 * Database Module
 * Handles IndexedDB operations for articles, vocabulary, and learn words
 */

import { getStemForm } from './helpers.js';

export function abortTransaction(tx, error) {
  tx.abort();
  return error;
}

function updateRecordFields(db, storeName, id, fields) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record) store.put({ ...record, ...fields });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const DB = {
  DB_NAME: 'EnglishReader',
  DB_VERSION: 10, // v10: independent evidence counters are normalized by the profile repository

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

        // v7: keep every explicit review as evidence for future calibration.
        if (!db.objectStoreNames.contains('reviewEvents')) {
          const store = db.createObjectStore('reviewEvents', { keyPath: 'id', autoIncrement: true });
          store.createIndex('wordId', 'wordId');
          store.createIndex('reviewedAt', 'reviewedAt');
          store.createIndex('source', 'source');
        }

        // v8: evidence-backed personal knowledge profile. Do not migrate
        // vocabulary or learnWords records: saving a word is not proof of knowing it.
        if (!db.objectStoreNames.contains('knowledgeWords')) {
          const store = db.createObjectStore('knowledgeWords', { keyPath: 'lemma' });
          store.createIndex('status', 'status');
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('knowledgeBands')) {
          const store = db.createObjectStore('knowledgeBands', { keyPath: 'band' });
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('knowledgeEvidence')) {
          const store = db.createObjectStore('knowledgeEvidence', { keyPath: 'id', autoIncrement: true });
          store.createIndex('lemma', 'lemma');
          store.createIndex('band', 'band');
          store.createIndex('occurredAt', 'occurredAt');
          store.createIndex('articleId', 'articleId');
          store.createIndex('questionId', 'questionId');
          store.createIndex('calibrationKey', 'calibrationKey', { unique: true });
        } else if (e.oldVersion < 9) {
          const store = e.target.transaction.objectStore('knowledgeEvidence');
          if (!store.indexNames.contains('calibrationKey')) {
            store.createIndex('calibrationKey', 'calibrationKey', { unique: true });
          }
        }
        if (!db.objectStoreNames.contains('knowledgeProfileMeta')) {
          db.createObjectStore('knowledgeProfileMeta', { keyPath: 'key' });
        }

        // v10 is intentionally a field-only migration. Existing derived
        // knowledge snapshots stay intact; knowledge-profile.mjs supplies
        // zero-valued independent counters when older records are read, so we
        // never invent independent evidence or rewrite user data in bulk.
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
    const serverTitleZh = String(serverArticle.titleZh || '').trim();
    // Check if already exists by URL
    const existing = await this.findArticleByUrl(articleUrl);

    // 已有本地记录: 始终允许补齐云端标题，正文仅在本地为空时补写。
    if (existing) {
      const localEmpty = !(existing.content && existing.content.trim());
      const fields = {};
      if (serverTitleZh && serverTitleZh !== String(existing.titleZh || '').trim()) {
        fields.titleZh = serverTitleZh;
      }
      if (localEmpty && newContent) {
        fields.content = serverArticle.content;
        fields.summary = serverArticle.summary || existing.summary || '';
        fields.difficulty = serverArticle.difficulty || existing.difficulty;
        fields.wordCount = serverArticle.wordCount || existing.wordCount;
      }
      if (Object.keys(fields).length) {
        await this.updateArticle(existing.id, fields);
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

  async updateWordDefinition(id, fields) {
    return updateRecordFields(await this.open(), 'vocabulary', id, fields);
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

  async updateLearnWordDefinition(id, fields) {
    return updateRecordFields(await this.open(), 'learnWords', id, fields);
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

  // Apply a schedule and append the explicit evidence in one transaction.
  // Existing words are left intact until the user actually reviews them.
  async recordLearnWordReview(id, srsData, event) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['learnWords', 'reviewEvents'], 'readwrite');
      const words = tx.objectStore('learnWords');
      const events = tx.objectStore('reviewEvents');
      const getReq = words.get(id);
      let updatedWord = null;
      let failure = null;

      getReq.onsuccess = () => {
        const word = getReq.result;
        if (!word) {
          failure = abortTransaction(tx, new Error('学习词不存在'));
          return;
        }
        updatedWord = { ...word, ...srsData };
        words.put(updatedWord);
        events.add({
          wordId: id,
          reviewedAt: Date.now(),
          rating: event.rating,
          source: event.source || 'flashcard',
          sawAnswer: Boolean(event.sawAnswer),
          previousInterval: Number(word.interval) || 0,
          nextInterval: Number(srsData.interval) || 0,
          previousState: word.state || (!word.reviewCount ? 'new' : 'legacy'),
          nextState: srsData.state || 'legacy',
          schedulerVersion: srsData.schedulerVersion || 1,
          ...event
        });
      };
      tx.oncomplete = () => resolve(updatedWord);
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || new Error('复习记录保存失败'));
    });
  },

  // Correct the current card's saved rating in place. The original score is
  // retained as audit metadata, while scheduling and the effective event use
  // the corrected score so a mistaken tap never becomes two reviews.
  async correctLearnWordReview(id, srsData, correction = {}) {
    const attemptId = String(correction.attemptId || '').trim();
    if (!attemptId) throw new TypeError('评分更正需要本次复习标识');

    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['learnWords', 'reviewEvents'], 'readwrite');
      const words = tx.objectStore('learnWords');
      const events = tx.objectStore('reviewEvents');
      let updatedWord = null;
      let failure = null;

      const fail = (message) => {
        failure = abortTransaction(tx, new Error(message));
      };

      const wordRequest = words.get(id);
      wordRequest.onsuccess = () => {
        const word = wordRequest.result;
        if (!word) {
          fail('学习词不存在');
          return;
        }

        const eventRequest = events.index('wordId').getAll(id);
        eventRequest.onsuccess = () => {
          const matching = eventRequest.result
            .filter(item => item.attemptId === attemptId && !item.correctedAt)
            .sort((a, b) => (b.reviewedAt - a.reviewedAt) || (b.id - a.id))[0];
          if (!matching) {
            fail('本次评分无法更正');
            return;
          }

          updatedWord = { ...word, ...srsData };
          words.put(updatedWord);
          events.put({
            ...matching,
            rating: 1,
            sawAnswer: Boolean(correction.sawAnswer),
            nextInterval: Number(srsData.interval) || 0,
            nextState: srsData.state || 'legacy',
            schedulerVersion: srsData.schedulerVersion || matching.schedulerVersion || 1,
            originalRating: matching.originalRating ?? matching.rating,
            correctedAt: Date.now(),
            correctionReason: correction.correctionReason || 'mistaken-known'
          });
        };
        eventRequest.onerror = () => {
          failure = eventRequest.error;
          tx.abort();
        };
      };
      wordRequest.onerror = () => {
        failure = wordRequest.error;
        tx.abort();
      };
      tx.oncomplete = () => resolve(updatedWord);
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || new Error('评分更正失败'));
    });
  },

  async getReviewEventsForWord(wordId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('reviewEvents', 'readonly');
      const req = tx.objectStore('reviewEvents').index('wordId').getAll(wordId);
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.reviewedAt - a.reviewedAt));
      req.onerror = () => reject(req.error);
    });
  },

  // Contextual exposure is useful analytics, but never changes an SRS schedule.
  async addReviewEvent(event) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('reviewEvents', 'readwrite');
      const req = tx.objectStore('reviewEvents').add({
        reviewedAt: Date.now(),
        rating: null,
        source: 'reading',
        sawAnswer: false,
        schedulerVersion: 2,
        ...event
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // ===== Personal Knowledge Profile =====
  // Kept deliberately separate from saved vocabulary and SRS cards.

  async getKnowledgeWord(lemma) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('knowledgeWords', 'readonly');
      const req = tx.objectStore('knowledgeWords').get(lemma);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getKnowledgeBand(band) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('knowledgeBands', 'readonly');
      const req = tx.objectStore('knowledgeBands').get(band);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getKnowledgeProfileMeta(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('knowledgeProfileMeta', 'readonly');
      const req = tx.objectStore('knowledgeProfileMeta').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async saveKnowledgeProfileMeta(record) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('knowledgeProfileMeta', 'readwrite');
      const req = tx.objectStore('knowledgeProfileMeta').put({ ...record });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // Store the derived word/band snapshots and the immutable evidence in one
  // transaction, so later UI never sees a half-applied mastery update.
  async saveKnowledgeProfileUpdate({ word, band, evidence }) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['knowledgeWords', 'knowledgeBands', 'knowledgeEvidence'], 'readwrite');
      const words = tx.objectStore('knowledgeWords');
      const bands = tx.objectStore('knowledgeBands');
      const events = tx.objectStore('knowledgeEvidence');
      let evidenceId = null;

      words.put({ ...word });
      bands.put({ ...band });
      const evidenceRequest = events.add({ ...evidence });
      evidenceRequest.onsuccess = () => {
        evidenceId = evidenceRequest.result;
      };
      evidenceRequest.onerror = () => reject(evidenceRequest.error);
      tx.oncomplete = () => resolve({
        word: { ...word },
        band: { ...band },
        evidence: { ...evidence, id: evidenceId }
      });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('知识证据保存失败'));
    });
  },

  async getKnowledgeEvidenceForWord(lemma) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('knowledgeEvidence', 'readonly');
      const req = tx.objectStore('knowledgeEvidence').index('lemma').getAll(lemma);
      req.onsuccess = () => resolve(req.result.sort((a, b) => (a.occurredAt - b.occurredAt) || (a.id - b.id)));
      req.onerror = () => reject(req.error);
    });
  },

  async getKnowledgeEvidenceByCalibrationKey(calibrationKey) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('knowledgeEvidence', 'readonly');
      const req = tx.objectStore('knowledgeEvidence').index('calibrationKey').get(calibrationKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async clearLearnWords() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['learnWords', 'reviewEvents'], 'readwrite');
      tx.objectStore('learnWords').clear();
      tx.objectStore('reviewEvents').clear();
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
