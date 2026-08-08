import { getAllByIndex, getByKey } from './db-helpers.mjs';

function requireExamId(examId) {
  if (!examId || typeof examId !== 'string') {
    throw new Error('exam 查询必须显式提供 examId');
  }
}

function requireBankId(bankId) {
  if (!bankId || typeof bankId !== 'string') {
    throw new Error('涉及题库的查询必须显式提供 bankId');
  }
}

export class ExamRepository {
  constructor({ openDb }) {
    if (typeof openDb !== 'function') throw new TypeError('ExamRepository 需要 openDb 函数');
    this.openDb = openDb;
  }

  async getPackMeta({ examId, packageId }) {
    requireExamId(examId);
    const record = await getByKey(this.openDb, 'examPackMeta', packageId);
    return record?.examId === examId ? record : null;
  }

  async listPackMetas({ examId }) {
    requireExamId(examId);
    return getAllByIndex(this.openDb, 'examPackMeta', 'examId', examId);
  }

  async getBank({ examId, bankId }) {
    requireExamId(examId);
    requireBankId(bankId);
    const record = await getByKey(this.openDb, 'examBanks', bankId);
    return record?.examId === examId ? record : null;
  }

  async listBanks({ examId }) {
    requireExamId(examId);
    return getAllByIndex(this.openDb, 'examBanks', 'examId', examId);
  }

  async getPaper({ examId, bankId, paperKey }) {
    requireExamId(examId);
    requireBankId(bankId);
    const record = await getByKey(this.openDb, 'examPapers', `${bankId}:${paperKey}`);
    return record?.examId === examId ? record : null;
  }

  async listPapers({ examId, bankId = null, packageId = null }) {
    requireExamId(examId);
    let rows = await getAllByIndex(this.openDb, 'examPapers', 'examId', examId);
    if (bankId) rows = rows.filter(row => row.bankId === bankId);
    if (packageId) rows = rows.filter(row => row.packageId === packageId);
    return rows;
  }

  async getUnit({ examId, bankId, unitKey }) {
    requireExamId(examId);
    requireBankId(bankId);
    const record = await getByKey(this.openDb, 'examUnits', `${bankId}:${unitKey}`);
    return record?.examId === examId ? record : null;
  }

  async listUnits({ examId, bankId = null, paperKey = null }) {
    requireExamId(examId);
    let rows = await getAllByIndex(this.openDb, 'examUnits', 'examId', examId);
    if (bankId) rows = rows.filter(row => row.bankId === bankId);
    if (paperKey) rows = rows.filter(row => row.paperKey === paperKey);
    return rows;
  }

  async getQuestion({ examId, bankId, questionKey }) {
    requireExamId(examId);
    requireBankId(bankId);
    const record = await getByKey(this.openDb, 'examQuestions', `${bankId}:${questionKey}`);
    return record?.examId === examId ? record : null;
  }

  async listQuestions({ examId, bankId = null, paperKey = null, unitKey = null }) {
    requireExamId(examId);
    let rows = await getAllByIndex(this.openDb, 'examQuestions', 'examId', examId);
    if (bankId) rows = rows.filter(row => row.bankId === bankId);
    if (paperKey) rows = rows.filter(row => row.paperKey === paperKey);
    if (unitKey) rows = rows.filter(row => row.unitKey === unitKey);
    return rows;
  }

  async getFullPaper({ examId, bankId, paperKey }) {
    const paper = await this.getPaper({ examId, bankId, paperKey });
    if (!paper) return null;
    if (paper.content) {
      return {
        ...paper.content,
        contentId: paper.contentId,
        contentHash: paper.contentHash,
        installedAt: paper.installedAt
      };
    }
    const units = await this.listUnits({ examId, bankId, paperKey });
    const questions = await this.listQuestions({ examId, bankId, paperKey });
    return {
      ...paper,
      units: units.map(unit => ({
        ...unit,
        questions: questions.filter(question => question.unitKey === unit.unitKey)
      }))
    };
  }
}
