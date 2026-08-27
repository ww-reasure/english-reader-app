/**
 * Database Module
 * Handles IndexedDB operations for articles, vocabulary, and learn words
 */

import { getStemForm } from './helpers.js';
import { normalizeCloudArticleMetadata } from './cloud-article-metadata.mjs';
import { localDayBounds, localDayKey } from './learning-day.mjs';
import { ActivityType, importWordDedupeKey, normalizeLearningActivity } from './learning-activity.mjs';
import { scheduleExternalReview } from './external-review-scheduler.mjs';
import {
  LIBRARY_SOURCE_VERSION,
  activateLibrarySource,
  createLibrarySources,
  deactivateLibrarySource,
  planLegacyVocabularyMigration,
  projectUnifiedVocabulary
} from './vocabulary-library.mjs';

const TRUSTED_VOCABULARY_DEFINITION_FIELDS = [
  'translation',
  'phonetic',
  'pos',
  'definitionSenses',
  'definitionSchemaVersion',
  'definitionLexiconVersion'
];

const DIAGNOSTIC_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DIAGNOSTIC_LOG_MAX_ENTRIES = 5_000;
const DIAGNOSTIC_LOG_MAX_BYTES = 2 * 1024 * 1024;

function normalizeStoredCloudMetadata(article = {}) {
  return normalizeCloudArticleMetadata(article);
}

function buildCloudArticleMetadataPatch(serverArticle, existing = {}) {
  const metadata = normalizeStoredCloudMetadata(serverArticle);
  const fields = {};

  // Only promote a proven past-exam source. A partial cloud response must not
  // downgrade metadata already stored on the device.
  if (metadata.sourceType === 'past-exam' || !existing.sourceType) {
    fields.sourceType = metadata.sourceType;
  }

  [
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
    'classifiedAt'
  ].forEach(key => {
    if (metadata[key] !== null && metadata[key] !== existing[key]) {
      fields[key] = metadata[key];
    }
  });
  return fields;
}

export function abortTransaction(tx, error) {
  tx.abort();
  return error;
}

function clonePlain(value) {
  if (value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function numericValue(value, fallback = null) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function keyRangeForBounds(from, to) {
  const keyRange = globalThis.IDBKeyRange;
  const lower = numericValue(from);
  const upper = numericValue(to);
  if (!keyRange) return null;
  if (lower !== null && upper !== null) return keyRange.bound(lower, upper, false, true);
  if (lower !== null) return keyRange.lowerBound(lower);
  if (upper !== null) return keyRange.upperBound(upper, true);
  return null;
}

function upperRangeBefore(before) {
  const keyRange = globalThis.IDBKeyRange;
  const limit = numericValue(before);
  return keyRange && limit !== null ? keyRange.upperBound(limit, true) : null;
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

function diagnosticLogger() {
  try {
    return globalThis?.__englishReaderDiagnosticLogger || null;
  } catch {
    return null;
  }
}

// Keep one physical connection per database/version pair. Import preview and
// other high-frequency read paths all share this cache; a failed or upgraded
// connection is removed by the lifecycle handlers below.
const connectionCache = new Map();
const openingConnections = new Map();

function databaseCacheKey(name, version) {
  return `${String(name)}:${Number(version)}`;
}

function closeCachedConnectionsForDatabase(name, keepKey) {
  for (const [key, connection] of connectionCache.entries()) {
    if (!key.startsWith(`${String(name)}:`) || key === keepKey) continue;
    try {
      connection.close();
    } catch {}
    connectionCache.delete(key);
  }
}

function attachConnectionLifecycle(connection, key) {
  const invalidate = () => {
    if (connectionCache.get(key) === connection) connectionCache.delete(key);
  };
  try {
    const nativeClose = connection.close.bind(connection);
    connection.close = (...args) => {
      invalidate();
      return nativeClose(...args);
    };
  } catch {}
  connection.onversionchange = () => {
    try {
      connection.close();
    } catch {}
    invalidate();
  };
  try {
    connection.onclose = invalidate;
  } catch {}
  return connection;
}

export const DB = {
  DB_NAME: 'EnglishReader',
  DB_VERSION: 21, // v21: idempotent formal review attempts

  // Open database connection with retry
  open(retries = 3, { diagnostics = true, correlationId = undefined } = {}) {
    const databaseName = String(this.DB_NAME);
    const databaseVersion = Number(this.DB_VERSION);
    const key = databaseCacheKey(databaseName, databaseVersion);
    const cached = connectionCache.get(key);
    if (cached) return Promise.resolve(cached);
    if (openingConnections.has(key)) return openingConnections.get(key);

    closeCachedConnectionsForDatabase(databaseName, key);

    const openWithRetry = remaining => new Promise((resolve, reject) => {
      const span = diagnostics
        ? diagnosticLogger()?.beginSpan('db.open', {
          category: 'db',
          correlationId,
          payload: { dbVersion: databaseVersion }
        })
        : null;
      const req = indexedDB.open(databaseName, databaseVersion);

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

        if (!db.objectStoreNames.contains('contextReviewSentences')) {
          const store = db.createObjectStore('contextReviewSentences', { keyPath: 'key' });
          store.createIndex('wordId', 'wordId');
          store.createIndex('lastUsedAt', 'lastUsedAt');
          store.createIndex('targetTrack', 'targetTrack');
        }
        if (!db.objectStoreNames.contains('contextReviewSessions')) {
          const store = db.createObjectStore('contextReviewSessions', { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }

        // v13: one metadata-only cloud shelf snapshot. This store is
        // additive and never rewrites articles, learning data or reading logs.
        if (!db.objectStoreNames.contains('articleCatalog')) {
          db.createObjectStore('articleCatalog', { keyPath: 'key' });
        }

        // v14: bounded, versioned AI material cache. This store is
        // deliberately additive: it never contains articles, vocabulary,
        // SRS state or reading history.
        if (!db.objectStoreNames.contains('aiCache')) {
          const store = db.createObjectStore('aiCache', { keyPath: 'key' });
          store.createIndex('updatedAt', 'updatedAt');
          store.createIndex('sizeBytes', 'sizeBytes');
        }

        // v14: exam practice content domain. These stores are additive and
        // only hold versioned question-bank content; user practice state will
        // be added in later phases and must never be replaced by pack upgrades.
        if (!db.objectStoreNames.contains('examPackMeta')) {
          const store = db.createObjectStore('examPackMeta', { keyPath: 'packageId' });
          store.createIndex('examId', 'examId');
          store.createIndex('bankId', 'bankId');
        }
        if (!db.objectStoreNames.contains('examBanks')) {
          const store = db.createObjectStore('examBanks', { keyPath: 'bankId' });
          store.createIndex('examId', 'examId');
        }
        if (!db.objectStoreNames.contains('examPapers')) {
          const store = db.createObjectStore('examPapers', { keyPath: 'contentId' });
          store.createIndex('examId', 'examId');
          store.createIndex('bankId', 'bankId');
          store.createIndex('packageId', 'packageId');
          store.createIndex('paperKey', 'paperKey');
        }
        if (!db.objectStoreNames.contains('examUnits')) {
          const store = db.createObjectStore('examUnits', { keyPath: 'contentId' });
          store.createIndex('examId', 'examId');
          store.createIndex('bankId', 'bankId');
          store.createIndex('packageId', 'packageId');
          store.createIndex('paperKey', 'paperKey');
          store.createIndex('unitKey', 'unitKey');
        }
        if (!db.objectStoreNames.contains('examQuestions')) {
          const store = db.createObjectStore('examQuestions', { keyPath: 'contentId' });
          store.createIndex('examId', 'examId');
          store.createIndex('bankId', 'bankId');
          store.createIndex('packageId', 'packageId');
          store.createIndex('paperKey', 'paperKey');
          store.createIndex('unitKey', 'unitKey');
          store.createIndex('questionKey', 'questionKey');
        }

        // v15: user practice state. These stores are deliberately separate
        // from content stores so pack upgrades never touch learning history.
        if (!db.objectStoreNames.contains('examAttempts')) {
          const store = db.createObjectStore('examAttempts', { keyPath: 'attemptId' });
          store.createIndex('examId', 'examId');
          store.createIndex('bankId', 'bankId');
          store.createIndex('packageId', 'packageId');
          store.createIndex('paperKey', 'paperKey');
          store.createIndex('unitKey', 'unitKey');
          store.createIndex('status', 'status');
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('examResponses')) {
          const store = db.createObjectStore('examResponses', { keyPath: 'responseId' });
          store.createIndex('examId', 'examId');
          store.createIndex('attemptId', 'attemptId');
          store.createIndex('bankId', 'bankId');
          store.createIndex('packageId', 'packageId');
          store.createIndex('paperKey', 'paperKey');
          store.createIndex('unitKey', 'unitKey');
          store.createIndex('questionKey', 'questionKey');
        }
        if (!db.objectStoreNames.contains('examWrongStates')) {
          const store = db.createObjectStore('examWrongStates', { keyPath: 'key' });
          store.createIndex('examId', 'examId');
          store.createIndex('bankId', 'bankId');
          store.createIndex('questionKey', 'questionKey');
          store.createIndex('status', 'status');
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('examBookmarks')) {
          const store = db.createObjectStore('examBookmarks', { keyPath: 'key' });
          store.createIndex('examId', 'examId');
          store.createIndex('bankId', 'bankId');
          store.createIndex('questionKey', 'questionKey');
          store.createIndex('createdAt', 'createdAt');
        }

        // v16: translation learning status. This is deliberately separate
        // from objective wrong states because translation has no correctness
        // grade and its three states are user mastery labels.
        if (!db.objectStoreNames.contains('examTranslationReviews')) {
          const store = db.createObjectStore('examTranslationReviews', { keyPath: 'key' });
          store.createIndex('examId', 'examId');
          store.createIndex('bankId', 'bankId');
          store.createIndex('paperKey', 'paperKey');
          store.createIndex('unitKey', 'unitKey');
          store.createIndex('questionKey', 'questionKey');
          store.createIndex('status', 'status');
          store.createIndex('updatedAt', 'updatedAt');
        }

        // v17: review scheduling is additive. Compound indexes make due
        // queries bounded by exam and lifecycle state; legacy active states
        // without a due time enter today's queue without rewriting history.
        if (e.oldVersion < 17) {
          const migrationTime = Date.now();
          const wrongStates = e.target.transaction.objectStore('examWrongStates');
          const translationReviews = e.target.transaction.objectStore('examTranslationReviews');
          if (!wrongStates.indexNames.contains('examIdStatusNextDueAt')) {
            wrongStates.createIndex('examIdStatusNextDueAt', ['examId', 'status', 'nextDueAt']);
          }
          if (!translationReviews.indexNames.contains('examIdStatusNextDueAt')) {
            translationReviews.createIndex('examIdStatusNextDueAt', ['examId', 'status', 'nextDueAt']);
          }

          const cursorRequest = wrongStates.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const row = cursor.value;
            if (row.status !== 'mastered' && row.nextDueAt == null) {
              cursor.update({
                ...row,
                status: 'active',
                nextDueAt: migrationTime,
                independentCorrectStreak: Number(row.independentCorrectStreak) || 0,
                firstAddedAt: row.firstAddedAt || row.createdAt || row.updatedAt || migrationTime,
                originAttemptId: row.originAttemptId || null,
                lastReviewedAt: row.lastReviewedAt ?? null,
                lastReviewAttemptId: row.lastReviewAttemptId ?? null,
                lastIndependentCorrectAt: row.lastIndependentCorrectAt ?? null,
                masteredAt: row.masteredAt ?? null,
                updatedAt: migrationTime
              });
            }
            cursor.continue();
          };
        }

        // v10 is intentionally a field-only migration. Existing derived
        // knowledge snapshots stay intact; knowledge-profile.mjs supplies
        // zero-valued independent counters when older records are read, so we
        // never invent independent evidence or rewrite user data in bulk.

        // v11 intentionally discards only reading data produced under the
        // previous permissive completion rule. Vocabulary, SRS, calibration
        // answers and word-level knowledge evidence are not reading history
        // and must remain untouched.
        if (e.oldVersion < 11) {
          e.target.transaction.objectStore('readingStats').clear();
          const meta = e.target.transaction.objectStore('knowledgeProfileMeta');
          meta.delete('knowledge-profile-qualified-readings');
          meta.delete('knowledge-profile-reading-feedback');
        }

        // v18: additive learning telemetry and deterministic daily report snapshots.
        if (!db.objectStoreNames.contains('learningActivityEvents')) {
          const store = db.createObjectStore('learningActivityEvents', { keyPath: 'id' });
          store.createIndex('occurredAt', 'occurredAt');
          store.createIndex('dayKey', 'dayKey');
          store.createIndex('type', 'type');
          store.createIndex('sessionId', 'sessionId');
          store.createIndex('dedupeKey', 'dedupeKey', { unique: true });
        }
        if (!db.objectStoreNames.contains('dailyLearningReports')) {
          const store = db.createObjectStore('dailyLearningReports', { keyPath: 'dateKey' });
          store.createIndex('updatedAt', 'updatedAt');
          store.createIndex('expiresAt', 'expiresAt');
        }

        // v19: durable image attachment metadata and local blobs for chat.
        // This store is additive: existing vocabulary, learning, reading and
        // practice records are never migrated or rewritten here.
        if (!db.objectStoreNames.contains('chatImageAttachments')) {
          const store = db.createObjectStore('chatImageAttachments', { keyPath: 'id' });
          store.createIndex('groupId', 'groupId');
          store.createIndex('conversationKey', 'conversationKey');
          store.createIndex('status', 'status');
          store.createIndex('createdAt', 'createdAt');
          store.createIndex('lastAccessedAt', 'lastAccessedAt');
        }

        // v20: local diagnostic events. This store is additive and is never
        // involved in vocabulary, article, review, report, or SRS writes.
        if (!db.objectStoreNames.contains('diagnosticLogs')) {
          const store = db.createObjectStore('diagnosticLogs', { keyPath: 'id' });
          store.createIndex('occurredAt', 'occurredAt');
          store.createIndex('level', 'level');
          store.createIndex('category', 'category');
          store.createIndex('event', 'event');
        }

        // v21: allow replayed optimistic review writes to detect the original
        // event without changing any existing learning or review records.
        if (e.oldVersion < 21) {
          const store = e.target.transaction.objectStore('reviewEvents');
          if (!store.indexNames.contains('attemptId')) {
            store.createIndex('attemptId', 'attemptId', { unique: false });
          }
        }
      };

      req.onblocked = () => {
        diagnosticLogger()?.record('db.open.blocked', {
          category: 'db',
          level: 'error',
          payload: { dbVersion: databaseVersion }
        });
      };
      req.onsuccess = () => {
        const connection = attachConnectionLifecycle(req.result, key);
        connectionCache.set(key, connection);
        span?.end({ payload: { version: connection?.version } });
        resolve(connection);
      };
      req.onerror = () => {
        span?.end({
          level: 'error',
          payload: { errorName: req.error?.name || 'UnknownError' }
        });
        if (remaining > 1) {
          setTimeout(() => openWithRetry(remaining - 1).then(resolve).catch(reject), 100);
        } else {
          reject(req.error || new Error('IndexedDB 打开失败'));
        }
      };
    });

    const opening = openWithRetry(Math.max(1, Number(retries) || 1)).finally(() => {
      if (openingConnections.get(key) === opening) openingConnections.delete(key);
    });
    openingConnections.set(key, opening);
    return opening;
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

  // ===== Cloud article catalog cache =====

  async getArticleCatalog(key = 'cloud-main') {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('articleCatalog', 'readonly');
      const req = tx.objectStore('articleCatalog').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async saveArticleCatalog(record) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('articleCatalog', 'readwrite');
      tx.objectStore('articleCatalog').put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  },

  // ===== Versioned AI material cache =====

  async getAiCache(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('aiCache', 'readonly');
      const req = tx.objectStore('aiCache').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async saveAiCache(record, { maxEntries = 1000, maxBytes = 12 * 1024 * 1024 } = {}) {
    if (!record?.key) return record;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('aiCache', 'readwrite');
      const store = tx.objectStore('aiCache');
      const allRequest = store.getAll();
      allRequest.onsuccess = () => {
        const existing = Array.isArray(allRequest.result) ? allRequest.result : [];
        const ordered = [record, ...existing.filter(item => item?.key !== record.key)]
          .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0));
        const limitEntries = Math.max(1, Number(maxEntries) || 1000);
        const limitBytes = Math.max(1, Number(maxBytes) || 12 * 1024 * 1024);
        const keep = [];
        let totalBytes = 0;
        for (const item of ordered) {
          const itemBytes = Math.max(0, Number(item?.sizeBytes) || 0);
          const mustKeepCurrent = item?.key === record.key;
          if (keep.length >= limitEntries) break;
          if (mustKeepCurrent || totalBytes + itemBytes <= limitBytes || keep.length === 0) {
            keep.push(item);
            totalBytes += itemBytes;
          }
        }
        const keepKeys = new Set(keep.map(item => item.key));
        for (const item of existing) {
          if (!keepKeys.has(item?.key)) store.delete(item.key);
        }
        for (const item of keep) store.put(item);
      };
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('AI cache transaction aborted'));
    });
  },

  async deleteAiCache(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('aiCache', 'readwrite');
      tx.objectStore('aiCache').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // ===== Chat image attachments =====

  async putChatImageAttachment(record) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chatImageAttachments', 'readwrite');
      const req = tx.objectStore('chatImageAttachments').put(clonePlain(record));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Chat image attachment transaction aborted'));
    });
  },

  async getChatImageAttachment(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chatImageAttachments', 'readonly');
      const req = tx.objectStore('chatImageAttachments').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getChatImageGroup(groupId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chatImageAttachments', 'readonly');
      const req = tx.objectStore('chatImageAttachments').index('groupId').getAll(groupId);
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? req.result : [];
        rows.sort((a, b) => {
          const orderDiff = (Number(a?.order) || 0) - (Number(b?.order) || 0);
          return orderDiff || String(a?.id || '').localeCompare(String(b?.id || ''));
        });
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  },

  async listChatImageAttachments({ conversationKey, statuses } = {}) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chatImageAttachments', 'readonly');
      const store = tx.objectStore('chatImageAttachments');
      const source = conversationKey == null
        ? store
        : store.index('conversationKey');
      const req = conversationKey == null
        ? source.getAll()
        : source.getAll(conversationKey);
      req.onsuccess = () => {
        const statusSet = statuses == null
          ? null
          : new Set(Array.isArray(statuses) ? statuses : [...statuses]);
        const rows = (Array.isArray(req.result) ? req.result : [])
          .filter(row => !statusSet || statusSet.size === 0 || statusSet.has(row?.status))
          .sort((a, b) => {
            const createdDiff = (Number(a?.createdAt) || 0) - (Number(b?.createdAt) || 0);
            return createdDiff || String(a?.id || '').localeCompare(String(b?.id || ''));
          });
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  },

  async updateChatImageAttachment(id, fields = {}) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chatImageAttachments', 'readwrite');
      const store = tx.objectStore('chatImageAttachments');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const current = getReq.result;
        if (!current) {
          resolve(null);
          return;
        }
        const updated = { ...current, ...clonePlain(fields) };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Chat image attachment transaction aborted'));
    });
  },

  async deleteChatImageAttachment(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chatImageAttachments', 'readwrite');
      tx.objectStore('chatImageAttachments').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Chat image attachment transaction aborted'));
    });
  },

  async releaseChatImageAttachment(id, { remoteDeletePending = false } = {}) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chatImageAttachments', 'readwrite');
      const store = tx.objectStore('chatImageAttachments');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const current = getReq.result;
        if (!current) {
          resolve(null);
          return;
        }
        const updated = {
          ...current,
          blob: null,
          sizeBytes: 0,
          status: remoteDeletePending ? 'delete_pending' : 'released',
          updatedAt: Date.now()
        };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Chat image attachment transaction aborted'));
    });
  },

  async deleteChatImageGroup(groupId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chatImageAttachments', 'readwrite');
      const store = tx.objectStore('chatImageAttachments');
      const req = store.index('groupId').getAll(groupId);
      req.onsuccess = () => {
        for (const row of req.result || []) store.delete(row.id);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Chat image group transaction aborted'));
    });
  },

  async getChatImageStorageBytes() {
    const rows = await this.listChatImageAttachments();
    return rows.reduce((total, row) => total + Math.max(0, Number(row?.sizeBytes) || 0), 0);
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
    const cloudMetadata = normalizeStoredCloudMetadata(serverArticle);
    // Check if already exists by URL
    const existing = await this.findArticleByUrl(articleUrl);

    // 已有本地记录: 始终允许补齐云端标题，正文仅在本地为空时补写。
    if (existing) {
      const localEmpty = !(existing.content && existing.content.trim());
      const fields = buildCloudArticleMetadataPatch(serverArticle, existing);
      if (serverTitleZh && serverTitleZh !== String(existing.titleZh || '').trim()) {
        fields.titleZh = serverTitleZh;
      }
      if (serverArticle.source && serverArticle.source !== existing.source) {
        fields.source = serverArticle.source;
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
        ...cloudMetadata,
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

  async saveVocabularyWord(wordData = {}, { occurredAt = Date.now() } = {}) {
    const lemma = getStemForm(wordData.word);
    if (!lemma) throw new TypeError('收藏需要有效的单词');
    const savedAt = numericValue(occurredAt, Date.now());
    const createdAt = numericValue(wordData.createdAt, savedAt);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['vocabulary', 'learnWords'], 'readwrite');
      const savedStore = tx.objectStore('vocabulary');
      const wordStore = tx.objectStore('learnWords');
      const savedRequest = savedStore.getAll();
      const wordRequest = wordStore.index('word').get(lemma);
      let savedRows = null;
      let previous;
      let result = null;
      let applied = false;
      let failure = null;

      const fail = error => {
        failure = error || new Error('收藏单词失败');
        try {
          tx.abort();
        } catch {}
      };

      const apply = () => {
        if (applied || savedRows === null || previous === undefined) return;
        applied = true;
        try {
          const activeSaved = savedRows.find(row =>
            row && row.archivedAt == null && getStemForm(row.word) === lemma
          );
          let vocabularyId = activeSaved?.id ?? null;
          let learnWordId = previous?.id ?? null;
          const createdVocabulary = !activeSaved;
          const createdLearnWord = !previous;

          if (createdVocabulary) {
            const savedRow = {
              ...wordData,
              word: String(wordData.word || lemma).trim(),
              createdAt
            };
            const addVocabularyRequest = savedStore.add(savedRow);
            addVocabularyRequest.onsuccess = () => {
              vocabularyId = addVocabularyRequest.result;
              maybeFinish();
            };
            addVocabularyRequest.onerror = () => fail(addVocabularyRequest.error);
          }

          if (createdLearnWord) {
            const canonical = {
              word: lemma,
              createdAt,
              libraryAddedAt: createdAt,
              librarySourceVersion: LIBRARY_SOURCE_VERSION,
              librarySources: createLibrarySources({ readingAt: savedAt }),
              archivedAt: null
            };
            for (const field of TRUSTED_VOCABULARY_DEFINITION_FIELDS) {
              if (wordData[field] !== undefined) canonical[field] = clonePlain(wordData[field]);
            }
            const addWordRequest = wordStore.add(canonical);
            addWordRequest.onsuccess = () => {
              learnWordId = addWordRequest.result;
              maybeFinish();
            };
            addWordRequest.onerror = () => fail(addWordRequest.error);
          } else {
            const updated = activateLibrarySource(previous, 'reading', savedAt);
            const updateWordRequest = wordStore.put(updated);
            updateWordRequest.onsuccess = () => maybeFinish();
            updateWordRequest.onerror = () => fail(updateWordRequest.error);
          }

          function maybeFinish() {
            if (result || vocabularyId == null || learnWordId == null) return;
            result = {
              vocabularyId,
              learnWordId,
              createdVocabulary,
              createdLearnWord,
              restored: Boolean(previous?.archivedAt != null)
            };
          }
        } catch (error) {
          fail(error);
        }
      };

      savedRequest.onsuccess = () => {
        savedRows = savedRequest.result || [];
        apply();
      };
      savedRequest.onerror = () => fail(savedRequest.error);
      wordRequest.onsuccess = () => {
        previous = wordRequest.result || null;
        apply();
      };
      wordRequest.onerror = () => fail(wordRequest.error);
      tx.oncomplete = () => {
        if (failure) reject(failure);
        else if (result) resolve(result);
        else reject(new Error('收藏单词未完成'));
      };
      tx.onerror = () => reject(failure || tx.error || new Error('收藏单词失败'));
      tx.onabort = () => reject(failure || tx.error || new Error('收藏单词失败'));
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
      const req = tx.objectStore('learnWords').add({ ...wordData, word: stemWord, reviewRevision: Math.max(0, Number(wordData.reviewRevision) || 0), createdAt: Date.now() });
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

  // Classify an import preview with one read-only transaction. The word and
  // daily-activity indexes are queried from the same connection so a large
  // PDF does not open IndexedDB once (or twice) per word.
  async classifyWordImportCandidates(words = [], dayKey = '') {
    const candidates = [...new Set((Array.isArray(words) ? words : [])
      .map(word => String(word || '').trim().toLocaleLowerCase('en-US'))
      .filter(Boolean))];
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['learnWords', 'learningActivityEvents'], 'readonly');
      const learnIndex = tx.objectStore('learnWords').index('word');
      const activityIndex = tx.objectStore('learningActivityEvents').index('dedupeKey');
      const existingWords = new Set();
      const todayProcessedWords = new Set();
      let failure = null;

      const fail = error => {
        failure = error || new Error('导入预分析失败');
        try {
          tx.abort();
        } catch {}
      };

      for (const candidate of candidates) {
        const stemWord = getStemForm(candidate);
        if (!stemWord) continue;
        const wordRequest = learnIndex.get(stemWord);
        wordRequest.onerror = () => fail(wordRequest.error);
        wordRequest.onsuccess = () => {
          if (!wordRequest.result) return;
          existingWords.add(candidate);
          const dailyRequest = activityIndex.get(importWordDedupeKey(dayKey, stemWord));
          dailyRequest.onerror = () => fail(dailyRequest.error);
          dailyRequest.onsuccess = () => {
            if (dailyRequest.result) todayProcessedWords.add(candidate);
          };
        };
      }

      tx.oncomplete = () => resolve({ existingWords, todayProcessedWords });
      tx.onerror = () => reject(failure || tx.error || new Error('导入预分析失败'));
      tx.onabort = () => reject(failure || tx.error || new Error('导入预分析失败'));
    });
  },

  async findLearnWordById(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('learnWords', 'readonly');
      const req = tx.objectStore('learnWords').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllLearnWords({ includeArchived = false } = {}) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('learnWords', 'readonly');
      const req = tx.objectStore('learnWords').getAll();
      req.onsuccess = () => resolve(includeArchived
        ? req.result
        : req.result.filter(word => word?.archivedAt == null));
      req.onerror = () => reject(req.error);
    });
  },

  async ensureUnifiedVocabulary() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['vocabulary', 'learnWords'], 'readwrite');
      const savedStore = tx.objectStore('vocabulary');
      const wordStore = tx.objectStore('learnWords');
      const savedRequest = savedStore.getAll();
      const wordsRequest = wordStore.getAll();
      let savedRows = null;
      let learnRows = null;
      let applied = false;
      let failure = null;

      const fail = error => {
        failure = error || new Error('统一词库迁移失败');
        try {
          tx.abort();
        } catch {}
      };

      const apply = () => {
        if (applied || savedRows === null || learnRows === null) return;
        applied = true;
        try {
          const plan = planLegacyVocabularyMigration({
            learnWords: learnRows,
            vocabulary: savedRows,
            normalizeLemma: getStemForm
          });
          for (const row of plan.updates) wordStore.put(row);
          for (const row of plan.inserts) wordStore.add(row);
        } catch (error) {
          fail(error);
        }
      };

      savedRequest.onsuccess = () => {
        savedRows = savedRequest.result || [];
        apply();
      };
      savedRequest.onerror = () => fail(savedRequest.error);
      wordsRequest.onsuccess = () => {
        learnRows = wordsRequest.result || [];
        apply();
      };
      wordsRequest.onerror = () => fail(wordsRequest.error);
      tx.oncomplete = () => failure ? reject(failure) : resolve();
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || new Error('统一词库迁移失败'));
    });
  },

  async getUnifiedVocabulary() {
    await this.ensureUnifiedVocabulary();
    const [learnWords, vocabulary] = await Promise.all([
      this.getAllLearnWords(),
      this.getAllWords()
    ]);
    return projectUnifiedVocabulary({
      learnWords,
      vocabulary,
      normalizeLemma: getStemForm
    });
  },

  async removeReadingVocabularySource(wordId, { occurredAt = Date.now() } = {}) {
    await this.ensureUnifiedVocabulary();
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['vocabulary', 'learnWords'], 'readwrite');
      const savedStore = tx.objectStore('vocabulary');
      const wordStore = tx.objectStore('learnWords');
      const wordRequest = wordStore.get(Number(wordId));
      const savedRequest = savedStore.getAll();
      let word = null;
      let savedRows = null;
      let failure = null;

      const fail = error => {
        failure = error || new Error('取消收藏失败');
        try {
          tx.abort();
        } catch {}
      };

      const apply = () => {
        if (word === null || savedRows === null) return;
        if (!word) return;
        const lemma = getStemForm(word.word);
        for (const saved of savedRows) {
          if (getStemForm(saved?.word) === lemma) savedStore.delete(saved.id);
        }
        wordStore.put(deactivateLibrarySource(word, 'reading', occurredAt));
        word = undefined;
      };

      wordRequest.onsuccess = () => {
        word = wordRequest.result || null;
        apply();
      };
      wordRequest.onerror = () => fail(wordRequest.error);
      savedRequest.onsuccess = () => {
        savedRows = savedRequest.result || [];
        apply();
      };
      savedRequest.onerror = () => fail(savedRequest.error);
      tx.oncomplete = () => failure ? reject(failure) : resolve();
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || new Error('取消收藏失败'));
    });
  },

  async archiveLearnWords(wordIds, { occurredAt = Date.now() } = {}) {
    const ids = [...new Set((Array.isArray(wordIds) ? wordIds : [wordIds])
      .map(id => Number(id))
      .filter(Number.isFinite))];
    if (!ids.length) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('learnWords', 'readwrite');
      const store = tx.objectStore('learnWords');
      for (const id of ids) {
        const request = store.get(id);
        request.onsuccess = () => {
          if (request.result) store.put({ ...request.result, archivedAt: occurredAt });
        };
        request.onerror = () => {
          try {
            tx.abort();
          } catch {}
          reject(request.error);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('移出词库失败'));
    });
  },

  async restoreLearnWordSource(wordId, source, { occurredAt = Date.now() } = {}) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('learnWords', 'readwrite');
      const store = tx.objectStore('learnWords');
      const request = store.get(Number(wordId));
      request.onsuccess = () => {
        if (request.result) store.put(activateLibrarySource(request.result, source, occurredAt));
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('恢复词库来源失败'));
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
    const db = await this.open(3, { correlationId: event?.correlationId });
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
        const currentRevision = Math.max(0, Number(word.reviewRevision) || 0);
        if (event.expectedRevision !== undefined && Number(event.expectedRevision) !== currentRevision) {
          failure = abortTransaction(tx, new Error('该单词已在另一种复习方式中更新'));
          return;
        }
        updatedWord = { ...word, ...srsData, reviewRevision: currentRevision + 1 };
        // expectedRevision is a transient UI CAS token, never a learnWords
        // field. Remove it defensively for older callers too.
        delete updatedWord.expectedRevision;
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
          reviewRevision: currentRevision + 1,
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

        if (correction.expectedRevision !== undefined
          && Number(correction.expectedRevision) !== Math.max(0, Number(word.reviewRevision) || 0)) {
          fail('该单词已在另一种复习方式中更新');
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
          delete updatedWord.expectedRevision;
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

  // ===== Local diagnostic logs =====

  async appendDiagnosticLogs(items = []) {
    const rows = Array.isArray(items)
      ? items.filter(item => item?.id).map(clonePlain)
      : [];
    if (!rows.length) return 0;
    const db = await this.open(3, { diagnostics: false });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('diagnosticLogs', 'readwrite');
      const store = tx.objectStore('diagnosticLogs');
      rows.forEach(row => store.put(row));
      const allRequest = store.getAll();
      allRequest.onsuccess = () => {
        const cutoff = Date.now() - DIAGNOSTIC_LOG_RETENTION_MS;
        const retained = allRequest.result
          .filter(row => Number(row.occurredAt) >= cutoff)
          .sort((left, right) => Number(right.occurredAt) - Number(left.occurredAt)
            || String(right.id).localeCompare(String(left.id)))
          .slice(0, DIAGNOSTIC_LOG_MAX_ENTRIES);
        let bytes = 0;
        const bounded = [];
        for (const row of retained) {
          let rowBytes = 0;
          try { rowBytes = JSON.stringify(row).length; } catch { rowBytes = 0; }
          if (bounded.length && bytes + rowBytes > DIAGNOSTIC_LOG_MAX_BYTES) break;
          bounded.push(row);
          bytes += rowBytes;
        }
        store.clear();
        bounded.forEach(row => store.put(row));
      };
      allRequest.onerror = () => reject(allRequest.error);
      tx.oncomplete = () => resolve(rows.length);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('诊断日志保存失败'));
    });
  },

  async listDiagnosticLogs({ from, to, limit = 5_000 } = {}) {
    const lower = numericValue(from);
    const upper = numericValue(to);
    const requestedLimit = Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 5_000;
    const cappedLimit = Math.max(0, Math.min(5_000, requestedLimit));
    const db = await this.open(3, { diagnostics: false });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('diagnosticLogs', 'readonly');
      const index = tx.objectStore('diagnosticLogs').index('occurredAt');
      const req = index.getAll();
      req.onsuccess = () => {
        const rows = req.result
          .filter(row => (lower === null || Number(row.occurredAt) >= lower)
            && (upper === null || Number(row.occurredAt) <= upper))
          .sort((left, right) => Number(left.occurredAt) - Number(right.occurredAt)
            || String(left.id).localeCompare(String(right.id)));
        resolve((cappedLimit === 0 ? [] : rows.slice(-cappedLimit)).map(clonePlain));
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getDiagnosticLogStats() {
    const rows = await this.listDiagnosticLogs({ limit: 5_000 });
    return {
      count: rows.length,
      bytes: rows.reduce((total, row) => {
        try {
          return total + JSON.stringify(row).length;
        } catch {
          return total;
        }
      }, 0),
      oldestAt: rows[0]?.occurredAt ?? null,
      newestAt: rows[rows.length - 1]?.occurredAt ?? null
    };
  },

  async clearDiagnosticLogs() {
    const db = await this.open(3, { diagnostics: false });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('diagnosticLogs', 'readwrite');
      tx.objectStore('diagnosticLogs').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('诊断日志清除失败'));
    });
  },

  // 专项复习评分：只记录练习事件，绝不修改 learnWords 的 SRS 字段
  // （nextReview / interval / state / easeFactor / reviewCount / reviewRevision 均保持不变）。
  async recordLearnWordPractice(id, { rating, sawAnswer = false, practiceScope = '' } = {}) {
    if (id === null || id === undefined || !Number.isFinite(Number(id))) throw new TypeError('练习评分需要有效的单词 id');
    const quality = [1, 3, 5].includes(Number(rating)) ? Number(rating) : null;
    if (quality === null) throw new TypeError('练习评分需要 1 / 3 / 5 的有效评分');
    return this.addReviewEvent({
      wordId: Number(id),
      rating: quality,
      source: 'practice-flashcard',
      sawAnswer: Boolean(sawAnswer),
      practiceScope: String(practiceScope || '')
    });
  },

  async applyWordImportSignal(wordData = {}, context = {}) {
    const lemma = getStemForm(wordData.word);
    if (!lemma) throw new TypeError('导入信号需要有效的单词');
    const occurredAt = numericValue(context.occurredAt, Date.now());
    const dayKey = String(context.dayKey || localDayKey(occurredAt));
    localDayBounds(dayKey);
    const dedupeKey = importWordDedupeKey(dayKey, lemma);
    const activityId = dedupeKey;
    const timezoneOffset = Number.isFinite(Number(context.timezoneOffset))
      ? Number(context.timezoneOffset)
      : new Date(occurredAt).getTimezoneOffset();
    const sessionId = String(context.sessionId || (context.batchId ? `import:${context.batchId}` : ''));
    const batchId = String(context.batchId || '');
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['learnWords', 'reviewEvents', 'learningActivityEvents'], 'readwrite');
      const words = tx.objectStore('learnWords');
      const reviewEvents = tx.objectStore('reviewEvents');
      const activities = tx.objectStore('learningActivityEvents');
      let result = null;
      let failure = null;

      const fail = error => {
        failure = error || new Error('导入信号保存失败');
        try {
          tx.abort();
        } catch {}
      };

      const addDailyActivity = ({ wordId, status, reason, scheduleChanged = false, creditDays = 0 }) => {
        const request = activities.add(normalizeLearningActivity({
          id: activityId,
          type: ActivityType.WORD_IMPORT_DAILY,
          occurredAt,
          dayKey,
          timezoneOffset,
          sessionId,
          dedupeKey,
          payload: {
            lemma,
            wordId,
            batchId,
            status,
            reason,
            scheduleChanged,
            creditDays
          }
        }));
        request.onerror = () => fail(request.error);
      };

      tx.oncomplete = () => {
        if (failure) reject(failure);
        else resolve(result);
      };
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || new Error('导入信号保存失败'));

      const dedupeRequest = activities.index('dedupeKey').get(dedupeKey);
      dedupeRequest.onerror = () => fail(dedupeRequest.error);
      dedupeRequest.onsuccess = () => {
        const existingActivity = dedupeRequest.result;
        const wordRequest = words.index('word').get(lemma);
        wordRequest.onerror = () => fail(wordRequest.error);
        wordRequest.onsuccess = () => {
          const word = wordRequest.result;
          const activatedWord = word ? activateLibrarySource(word, 'import', occurredAt) : null;
          const resolveTodayIgnored = () => {
            result = {
              status: 'today_ignored',
              wordId: word?.id ?? existingActivity?.payload?.wordId ?? null,
              lemma,
              scheduleChanged: false,
              reason: 'today_ignored'
            };
          };

          if (existingActivity) {
            if (!activatedWord) {
              resolveTodayIgnored();
              return;
            }
            const reactivateRequest = words.put(activatedWord);
            reactivateRequest.onerror = () => fail(reactivateRequest.error);
            reactivateRequest.onsuccess = resolveTodayIgnored;
            return;
          }

          if (!word) {
            const newWord = {
              ...wordData,
              word: lemma,
              reviewRevision: Math.max(0, Number(wordData.reviewRevision) || 0),
              createdAt: wordData.createdAt ?? occurredAt,
              librarySourceVersion: LIBRARY_SOURCE_VERSION,
              librarySources: createLibrarySources({ importAt: occurredAt }),
              libraryAddedAt: occurredAt,
              archivedAt: null
            };
            const addWordRequest = words.add(newWord);
            addWordRequest.onerror = () => fail(addWordRequest.error);
            addWordRequest.onsuccess = () => {
              const wordId = addWordRequest.result;
              result = {
                status: 'new',
                wordId,
                lemma,
                scheduleChanged: false,
                reason: 'new'
              };
              addDailyActivity({ wordId, status: 'new', reason: 'new' });
            };
            return;
          }

          const decision = scheduleExternalReview(activatedWord, occurredAt);
          const updatedWord = { ...activatedWord, ...decision.patch };
          const updateRequest = words.put(updatedWord);
          updateRequest.onerror = () => fail(updateRequest.error);
          updateRequest.onsuccess = () => {
            const reviewRequest = reviewEvents.add({
              wordId: word.id,
              reviewedAt: occurredAt,
              rating: null,
              source: 'external-import',
              sawAnswer: false,
              schedulerVersion: 2,
              evidenceStrength: 'medium',
              scheduleChanged: Boolean(decision.scheduleChanged),
              creditDays: decision.creditDays,
              batchId,
              reason: decision.reason,
              previousInterval: Number(word.interval) || 0,
              nextInterval: Number(word.interval) || 0,
              previousState: word.state || (!word.reviewCount ? 'new' : 'legacy'),
              nextState: updatedWord.state || (!updatedWord.reviewCount ? 'new' : 'legacy'),
              reviewRevision: updatedWord.reviewRevision ?? Math.max(0, Number(word.reviewRevision) || 0)
            });
            reviewRequest.onerror = () => fail(reviewRequest.error);
            reviewRequest.onsuccess = () => {
              result = {
                status: 'external_review',
                wordId: word.id,
                lemma,
                scheduleChanged: Boolean(decision.scheduleChanged),
                reason: decision.reason
              };
              addDailyActivity({
                wordId: word.id,
                status: 'external_review',
                reason: decision.reason,
                scheduleChanged: decision.scheduleChanged,
                creditDays: decision.creditDays
              });
            };
          };
        };
      };
    });
  },

  async saveLearningActivity(record) {
    const normalized = normalizeLearningActivity(record);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('learningActivityEvents', 'readwrite');
      const req = tx.objectStore('learningActivityEvents').put(normalized);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve(clonePlain(normalized));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('学习活动保存失败'));
    });
  },

  async getLearningActivityByDedupeKey(dedupeKey) {
    if (!dedupeKey) return null;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('learningActivityEvents', 'readonly');
      const req = tx.objectStore('learningActivityEvents').index('dedupeKey').get(String(dedupeKey));
      req.onsuccess = () => resolve(clonePlain(req.result) || null);
      req.onerror = () => reject(req.error);
    });
  },

  async listLearningActivities({ from, to, types = [] } = {}) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('learningActivityEvents', 'readonly');
      const index = tx.objectStore('learningActivityEvents').index('occurredAt');
      const range = keyRangeForBounds(from, to);
      const req = range ? index.getAll(range) : index.getAll();
      req.onsuccess = () => {
        const lower = numericValue(from);
        const upper = numericValue(to);
        const hasTypeFilter = Array.isArray(types) && types.length > 0;
        const requestedTypes = new Set((Array.isArray(types) ? types : [])
          .filter(type => Object.values(ActivityType).includes(type)));
        const rows = req.result
          .filter(row => (lower === null || Number(row.occurredAt) >= lower)
            && (upper === null || Number(row.occurredAt) < upper))
          .filter(row => !hasTypeFilter || requestedTypes.has(row.type))
          .sort((left, right) => (Number(left.occurredAt) - Number(right.occurredAt))
            || String(left.id).localeCompare(String(right.id)));
        resolve(rows.map(clonePlain));
      };
      req.onerror = () => reject(req.error);
    });
  },

  async saveDailyLearningReport(report) {
    const dateKey = String(report?.dateKey || '');
    if (!dateKey) throw new TypeError('日报需要日期');
    localDayBounds(dateKey);
    const stored = clonePlain({ ...report, dateKey });
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('dailyLearningReports', 'readwrite');
      const req = tx.objectStore('dailyLearningReports').put(stored);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve(clonePlain(stored));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('日报保存失败'));
    });
  },

  async getDailyLearningReport(dateKey) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('dailyLearningReports', 'readonly');
      const req = tx.objectStore('dailyLearningReports').get(String(dateKey || ''));
      req.onsuccess = () => resolve(clonePlain(req.result) || null);
      req.onerror = () => reject(req.error);
    });
  },

  async listDailyLearningReports({ limit = 30 } = {}) {
    const requestedLimit = Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 30;
    const cappedLimit = Math.max(0, Math.min(30, requestedLimit));
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('dailyLearningReports', 'readonly');
      const req = tx.objectStore('dailyLearningReports').index('updatedAt').getAll();
      req.onsuccess = () => resolve(req.result
        .sort((left, right) => (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0)
          || String(right.dateKey).localeCompare(String(left.dateKey)))
        .slice(0, cappedLimit)
        .map(clonePlain));
      req.onerror = () => reject(req.error);
    });
  },

  async deleteExpiredLearningTelemetry({ reportBefore, activityBefore } = {}) {
    const reportLimit = numericValue(reportBefore);
    const activityLimit = numericValue(activityBefore);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['dailyLearningReports', 'learningActivityEvents'], 'readwrite');
      let reportsDeleted = 0;
      let activitiesDeleted = 0;
      let failure = null;

      const deleteBefore = (storeName, indexName, before, onDelete) => {
        if (before === null) return;
        const index = tx.objectStore(storeName).index(indexName);
        const range = upperRangeBefore(before);
        const req = range ? index.openCursor(range) : index.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          if (!range && Number(cursor.key) >= before) return;
          cursor.delete();
          onDelete();
          cursor.continue();
        };
        req.onerror = () => {
          failure = req.error;
          tx.abort();
        };
      };

      deleteBefore('dailyLearningReports', 'updatedAt', reportLimit, () => { reportsDeleted += 1; });
      deleteBefore('learningActivityEvents', 'occurredAt', activityLimit, () => { activitiesDeleted += 1; });

      tx.oncomplete = () => resolve({ reportsDeleted, activitiesDeleted });
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || new Error('遥测清理失败'));
    });
  },

  // V2 会话结算：正式复习评分统一入口。按 recovery 状态机更新 learnWords，
  // 并在同一事务写入带 sessionDebt / recoveryStage 的 reviewEvents。
  async settleSessionReview(id, srsData, event = {}, options = {}) {
    const db = await this.open(3, { correlationId: event?.correlationId });
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['learnWords', 'reviewEvents'], 'readwrite');
      const words = tx.objectStore('learnWords');
      const events = tx.objectStore('reviewEvents');
      let updatedWord = null;
      let failure = null;
      const attemptId = String(options.attemptId || event.attemptId || '').trim();
      const expectedRevision = options.expectedRevision !== undefined
        ? options.expectedRevision
        : event.expectedRevision;
      let word = null;
      let wordReady = false;
      let attemptReady = !attemptId;
      let existingAttempt = null;

      const finishReadPhase = () => {
        if (!wordReady || !attemptReady) return;
        if (!word) {
          failure = abortTransaction(tx, new Error('学习词不存在'));
          return;
        }

        // A retry after the original transaction committed is a successful
        // no-op. This check happens inside the same readwrite transaction as
        // the revision check and write, so it cannot double-advance SRS.
        if (existingAttempt) {
          updatedWord = { ...word };
          return;
        }

        const currentRevision = Math.max(0, Number(word.reviewRevision) || 0);
        if (expectedRevision !== undefined && Number(expectedRevision) !== currentRevision) {
          failure = abortTransaction(tx, new Error('该单词已在另一种复习方式中更新'));
          return;
        }
        updatedWord = { ...word, ...srsData, reviewRevision: currentRevision + 1 };
        // expectedRevision is a transient UI CAS token, never a learnWords
        // field. Remove it defensively for older callers too.
        delete updatedWord.expectedRevision;
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
          schedulerVersion: 2,
          reviewRevision: currentRevision + 1,
          sessionDebt: Number(event.sessionDebt) || 0,
          recoveryStage: Number(srsData.recoveryStage) || 0,
          recoveryTarget: Number(srsData.recoveryTarget) || 0,
          lastDebt: Number(srsData.lastDebt) || 0,
          ...event,
          ...(attemptId ? { attemptId } : {})
        });
      };

      const getReq = words.get(id);
      getReq.onsuccess = () => {
        word = getReq.result;
        wordReady = true;
        finishReadPhase();
      };
      getReq.onerror = () => {
        failure = getReq.error;
        tx.abort();
      };

      if (attemptId && events.indexNames.contains('attemptId')) {
        const attemptReq = events.index('attemptId').get(attemptId);
        attemptReq.onsuccess = () => {
          existingAttempt = attemptReq.result || null;
          attemptReady = true;
          finishReadPhase();
        };
        attemptReq.onerror = () => {
          failure = attemptReq.error;
          tx.abort();
        };
      }
      tx.oncomplete = () => resolve(updatedWord);
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || new Error('复习记录保存失败'));
    });
  },

  // 通用复习会话描述符（V2 会话内重插断点恢复）
  async saveReviewSession(session) {
    if (!session?.id) throw new TypeError('复习会话需要稳定标识');
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('contextReviewSessions', 'readwrite');
      const req = tx.objectStore('contextReviewSessions').put({ ...session, kind: 'review-session' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getReviewSession(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('contextReviewSessions', 'readonly');
      const req = tx.objectStore('contextReviewSessions').get(id);
      req.onsuccess = () => resolve(req.result?.kind === 'review-session' ? req.result : null);
      req.onerror = () => reject(req.error);
    });
  },

  async deleteReviewSession(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('contextReviewSessions', 'readwrite');
      tx.objectStore('contextReviewSessions').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // ===== Context review sentence bank and resumable sessions =====

  async saveContextReviewSentences(items = []) {
    const rows = Array.isArray(items) ? items.filter(item => item?.key) : [];
    if (!rows.length) return [];
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('contextReviewSentences', 'readwrite');
      const store = tx.objectStore('contextReviewSentences');
      rows.forEach(item => store.put({ ...item }));
      tx.oncomplete = () => resolve(rows.map(item => ({ ...item })));
      tx.onerror = () => reject(tx.error);
    });
  },

  async getContextReviewSentencesForWord(wordId, limit = 10) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('contextReviewSentences', 'readonly');
      const req = tx.objectStore('contextReviewSentences').index('wordId').getAll(wordId);
      req.onsuccess = () => resolve(req.result
        .sort((left, right) => (Number(right.lastUsedAt) || 0) - (Number(left.lastUsedAt) || 0))
        .slice(0, Math.max(0, Number(limit) || 0)));
      req.onerror = () => reject(req.error);
    });
  },

  async saveContextReviewSession(session) {
    if (!session?.id) throw new TypeError('语境复习会话需要稳定标识');
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('contextReviewSessions', 'readwrite');
      const req = tx.objectStore('contextReviewSessions').put({ ...session });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getContextReviewSession(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('contextReviewSessions', 'readonly');
      const req = tx.objectStore('contextReviewSessions').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async deleteContextReviewSession(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('contextReviewSessions', 'readwrite');
      tx.objectStore('contextReviewSessions').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
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
      const tx = db.transaction(['learnWords', 'reviewEvents', 'contextReviewSentences', 'contextReviewSessions'], 'readwrite');
      tx.objectStore('learnWords').clear();
      tx.objectStore('reviewEvents').clear();
      tx.objectStore('contextReviewSentences').clear();
      tx.objectStore('contextReviewSessions').clear();
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

// The small `.mjs` cache adapter is also used by Node-side cache tests. Expose
// the already-loaded database service without making that adapter import this
// browser `.js` module directly (the package intentionally remains CommonJS
// for its scripts).
globalThis.__EnglishReaderDB = DB;
