import {
  deleteRecord,
  getAllByIndex,
  getAllByIndexRange,
  getByKey,
  putRecord,
  runStoreTransaction
} from './db-helpers.mjs';
import { transitionObjectiveReview } from './review-scheduler.mjs';

function requireExamId(examId) {
  if (!examId || typeof examId !== 'string') {
    throw new Error('exam 用户状态查询必须显式提供 examId');
  }
}

function requireBankId(bankId) {
  if (!bankId || typeof bankId !== 'string') {
    throw new Error('涉及题库的用户状态必须显式提供 bankId');
  }
}

export class ExamStateRepository {
  constructor({ openDb }) {
    if (typeof openDb !== 'function') throw new TypeError('ExamStateRepository 需要 openDb 函数');
    this.openDb = openDb;
  }

  async getAttempt({ examId, attemptId }) {
    requireExamId(examId);
    const record = await getByKey(this.openDb, 'examAttempts', attemptId);
    return record?.examId === examId ? record : null;
  }

  async listAttempts({ examId, bankId = null, paperKey = null, unitKey = null, status = null }) {
    requireExamId(examId);
    let rows = await getAllByIndex(this.openDb, 'examAttempts', 'examId', examId);
    if (bankId) rows = rows.filter(row => row.bankId === bankId);
    if (paperKey) rows = rows.filter(row => row.paperKey === paperKey);
    if (unitKey) rows = rows.filter(row => row.unitKey === unitKey);
    if (status) rows = rows.filter(row => row.status === status);
    return rows.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async saveAttempt({ examId, attempt }) {
    requireExamId(examId);
    if (!attempt || attempt.examId !== examId) throw new Error('attempt.examId 与查询 examId 不一致');
    const existing = await getByKey(this.openDb, 'examAttempts', attempt.attemptId);
    if (existing?.status === 'submitted' && attempt.status !== 'submitted') {
      throw new Error('已提交的 attempt 不可修改');
    }
    attempt.updatedAt = Date.now();
    return putRecord(this.openDb, 'examAttempts', attempt);
  }

  async abandonAttempt({ examId, attemptId }) {
    const attempt = await this.getAttempt({ examId, attemptId });
    if (!attempt) throw new Error(`attempt 不存在：${attemptId}`);
    if (attempt.status === 'submitted') throw new Error('已提交的 attempt 不能放弃');
    return this.saveAttempt({ examId, attempt: { ...attempt, status: 'abandoned', updatedAt: Date.now() } });
  }

  async getResponses({ examId, attemptId }) {
    requireExamId(examId);
    const rows = await getAllByIndex(this.openDb, 'examResponses', 'attemptId', attemptId);
    return rows.filter(row => row.examId === examId);
  }

  async saveResponse({ examId, response }) {
    requireExamId(examId);
    if (!response || response.examId !== examId) throw new Error('response.examId 与查询 examId 不一致');
    const attempt = await getByKey(this.openDb, 'examAttempts', response.attemptId);
    if (attempt?.status === 'submitted') throw new Error('已提交的 attempt 不可修改 response');
    return putRecord(this.openDb, 'examResponses', response);
  }

  async saveAttemptAndResponses({ examId, attempt, responses }) {
    requireExamId(examId);
    if (!attempt || attempt.examId !== examId) throw new Error('attempt.examId 与查询 examId 不一致');
    if (responses.some(response => response.examId !== examId)) {
      throw new Error('responses 包含其他 examId');
    }
    const existing = await getByKey(this.openDb, 'examAttempts', attempt.attemptId);
    if (existing?.status === 'submitted') throw new Error('已提交的 attempt 不可修改');
    return runStoreTransaction(this.openDb, ['examAttempts', 'examResponses'], 'readwrite', tx => {
      tx.objectStore('examAttempts').put(attempt);
      for (const response of responses) tx.objectStore('examResponses').put(response);
    });
  }

  async submitAttemptAtomically({ examId, attempt, responses }) {
    requireExamId(examId);
    if (!attempt || attempt.examId !== examId) throw new Error('attempt.examId 与查询 examId 不一致');
    if (responses.some(response => response.examId !== examId)) {
      throw new Error('responses 包含其他 examId');
    }
    const submittedAt = attempt.submittedAt || Date.now();
    return runStoreTransaction(this.openDb, ['examAttempts', 'examResponses', 'examWrongStates'], 'readwrite', tx => {
      tx.objectStore('examAttempts').put(attempt);
      for (const response of responses) tx.objectStore('examResponses').put(response);

      const wrongStates = tx.objectStore('examWrongStates');
      for (const response of responses) {
        const getRequest = wrongStates.get(`${attempt.bankId}:${response.questionKey}`);
        getRequest.onsuccess = () => {
          const current = getRequest.result;
          if (!current || current.examId !== examId) return;
          const next = transitionObjectiveReview({
            state: current,
            attempt,
            response,
            now: submittedAt
          });
          if (next !== current) wrongStates.put(next);
        };
      }
    });
  }

  async getWrongState({ examId, bankId, questionKey }) {
    requireExamId(examId);
    requireBankId(bankId);
    const record = await getByKey(this.openDb, 'examWrongStates', `${bankId}:${questionKey}`);
    return record?.examId === examId ? record : null;
  }

  async listWrongStates({ examId, bankId = null, questionKeys = null }) {
    requireExamId(examId);
    let rows = await getAllByIndex(this.openDb, 'examWrongStates', 'examId', examId);
    if (bankId) rows = rows.filter(row => row.bankId === bankId);
    if (questionKeys) {
      const keys = new Set(questionKeys);
      rows = rows.filter(row => keys.has(row.questionKey));
    }
    return rows.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async listDueWrongStates({ examId, bankId = null, now = Date.now() }) {
    requireExamId(examId);
    const keyRange = globalThis.IDBKeyRange;
    if (!keyRange) throw new Error('当前环境缺少 IDBKeyRange');
    let rows = await getAllByIndexRange(
      this.openDb,
      'examWrongStates',
      'examIdStatusNextDueAt',
      keyRange.bound([examId, 'active', 0], [examId, 'active', now])
    );
    if (bankId) rows = rows.filter(row => row.bankId === bankId);
    return rows.sort((left, right) => (left.nextDueAt - right.nextDueAt) || (left.updatedAt - right.updatedAt));
  }

  async saveWrongState({ examId, wrongState }) {
    requireExamId(examId);
    requireBankId(wrongState?.bankId);
    if (wrongState.examId !== examId) throw new Error('wrongState.examId 与查询 examId 不一致');
    wrongState.updatedAt = Date.now();
    return putRecord(this.openDb, 'examWrongStates', wrongState);
  }

  async removeWrongState({ examId, bankId, questionKey }) {
    requireExamId(examId);
    requireBankId(bankId);
    return deleteRecord(this.openDb, 'examWrongStates', `${bankId}:${questionKey}`);
  }

  async getTranslationReview({ examId, bankId, questionKey }) {
    requireExamId(examId);
    requireBankId(bankId);
    const record = await getByKey(this.openDb, 'examTranslationReviews', `${bankId}:${questionKey}`);
    return record?.examId === examId ? record : null;
  }

  async listTranslationReviews({ examId, bankId = null, unitKey = null, questionKeys = null }) {
    requireExamId(examId);
    let rows = await getAllByIndex(this.openDb, 'examTranslationReviews', 'examId', examId);
    if (bankId) rows = rows.filter(row => row.bankId === bankId);
    if (unitKey) rows = rows.filter(row => row.unitKey === unitKey);
    if (questionKeys) {
      const keys = new Set(questionKeys);
      rows = rows.filter(row => keys.has(row.questionKey));
    }
    return rows.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async listDueTranslationReviews({ examId, bankId = null, now = Date.now() }) {
    requireExamId(examId);
    const keyRange = globalThis.IDBKeyRange;
    if (!keyRange) throw new Error('当前环境缺少 IDBKeyRange');
    const rowsByStatus = await Promise.all(['needs_review', 'mostly_mastered'].map(status => getAllByIndexRange(
      this.openDb,
      'examTranslationReviews',
      'examIdStatusNextDueAt',
      keyRange.bound([examId, status, 0], [examId, status, now])
    )));
    let rows = rowsByStatus.flat();
    if (bankId) rows = rows.filter(row => row.bankId === bankId);
    return rows.sort((left, right) => (left.nextDueAt - right.nextDueAt) || (left.updatedAt - right.updatedAt));
  }

  async saveTranslationReview({ examId, review }) {
    requireExamId(examId);
    requireBankId(review?.bankId);
    if (review.examId !== examId) throw new Error('translation review.examId 与查询 examId 不一致');
    if (!['needs_review', 'mostly_mastered', 'mastered'].includes(review.status)) {
      throw new Error('translation review.status 无效');
    }
    review.updatedAt = Date.now();
    return putRecord(this.openDb, 'examTranslationReviews', review);
  }

  async removeTranslationReview({ examId, bankId, questionKey }) {
    requireExamId(examId);
    requireBankId(bankId);
    return deleteRecord(this.openDb, 'examTranslationReviews', `${bankId}:${questionKey}`);
  }

  async getBookmark({ examId, bankId, questionKey }) {
    requireExamId(examId);
    requireBankId(bankId);
    const record = await getByKey(this.openDb, 'examBookmarks', `${bankId}:${questionKey}`);
    return record?.examId === examId ? record : null;
  }

  async listBookmarks({ examId, bankId = null }) {
    requireExamId(examId);
    let rows = await getAllByIndex(this.openDb, 'examBookmarks', 'examId', examId);
    if (bankId) rows = rows.filter(row => row.bankId === bankId);
    return rows.sort((left, right) => right.createdAt - left.createdAt);
  }

  async saveBookmark({ examId, bookmark }) {
    requireExamId(examId);
    requireBankId(bookmark?.bankId);
    if (bookmark.examId !== examId) throw new Error('bookmark.examId 与查询 examId 不一致');
    bookmark.updatedAt = Date.now();
    return putRecord(this.openDb, 'examBookmarks', bookmark);
  }

  async removeBookmark({ examId, bankId, questionKey }) {
    requireExamId(examId);
    requireBankId(bankId);
    return deleteRecord(this.openDb, 'examBookmarks', `${bankId}:${questionKey}`);
  }
}
