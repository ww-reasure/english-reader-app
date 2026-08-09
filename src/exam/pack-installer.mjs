import { EXAM_STORES_V14 } from './constants.mjs';
import { assertExamPack, hashQuestion } from './pack.mjs';
import { getByKey } from './db-helpers.mjs';

async function buildExamPackRecords(pack) {
  const { manifest, papers } = pack;
  const installedAt = Date.now();
  const records = {
    examPackMeta: [
      {
        packageId: manifest.packageId,
        packageVersion: manifest.packageVersion,
        examId: manifest.examId,
        bankId: manifest.bankId,
        displayName: manifest.displayName,
        contentHash: manifest.contentHash,
        generatedAt: manifest.generatedAt,
        installedAt,
        papers: manifest.papers
      }
    ],
    examBanks: [
      {
        bankId: manifest.bankId,
        examId: manifest.examId,
        packageId: manifest.packageId,
        displayName: manifest.displayName,
        installedAt
      }
    ],
    examPapers: [],
    examUnits: [],
    examQuestions: []
  };

  const paperHashByKey = new Map(manifest.papers.map(paper => [paper.paperKey, paper.contentHash]));
  for (const paper of papers) {
    const paperRecordKey = `${paper.bankId}:${paper.paperKey}`;
    records.examPapers.push({
      contentId: paperRecordKey,
      bankId: paper.bankId,
      packageId: manifest.packageId,
      packageVersion: manifest.packageVersion,
      examId: paper.examId,
      paperKey: paper.paperKey,
      year: paper.year,
      title: paper.title,
      sourceType: paper.sourceType,
      contentHash: paperHashByKey.get(paper.paperKey),
      content: paper,
      installedAt
    });
    for (const unit of paper.units) {
      records.examUnits.push({
        contentId: `${paper.bankId}:${unit.unitKey}`,
        bankId: paper.bankId,
        packageId: manifest.packageId,
        packageVersion: manifest.packageVersion,
        examId: paper.examId,
        paperKey: paper.paperKey,
        unitKey: unit.unitKey,
        type: unit.type,
        displayTitle: unit.displayTitle,
        installedAt
      });
      for (const question of unit.questions) {
        records.examQuestions.push({
          contentId: `${paper.bankId}:${question.questionKey}`,
          bankId: paper.bankId,
          packageId: manifest.packageId,
          packageVersion: manifest.packageVersion,
          examId: paper.examId,
          paperKey: paper.paperKey,
          unitKey: unit.unitKey,
          questionKey: question.questionKey,
          type: question.type,
          points: question.points,
          answer: question.answer,
          optionKeys: (question.options || []).map(option => option.key),
          contentHash: await hashQuestion(question),
          installedAt
        });
      }
    }
  }

  return records;
}

function writeRecords(tx, records) {
  for (const [storeName, items] of Object.entries(records)) {
    const store = tx.objectStore(storeName);
    for (const item of items) store.put(item);
  }
}

function deleteByIndex(tx, storeName, indexName, indexValue, onDone, onError) {
  let request;
  try {
    request = tx.objectStore(storeName).index(indexName).getAll(indexValue);
  } catch (error) {
    onError(error);
    return;
  }
  request.onsuccess = () => {
    const store = tx.objectStore(storeName);
    for (const record of request.result) store.delete(record[store.keyPath]);
    onDone();
  };
  request.onerror = () => onError(request.error);
}

export async function installExamPack(openDb, pack, { resetStateForContentHashes = [] } = {}) {
  await assertExamPack(pack);
  const db = await openDb();
  const existing = await getByKey(() => Promise.resolve(db), 'examPackMeta', pack.manifest.packageId);
  const status = existing
    ? existing.packageVersion === pack.manifest.packageVersion && existing.contentHash === pack.manifest.contentHash
      ? 'unchanged'
      : 'upgraded'
    : 'installed';
  if (status === 'unchanged') return { status, packageId: pack.manifest.packageId };

  const existingBank = await getByKey(() => Promise.resolve(db), 'examBanks', pack.manifest.bankId);
  if (existingBank && existingBank.examId !== pack.manifest.examId) {
    throw new Error(`bankId 必须全局唯一，${pack.manifest.bankId} 已属于 exam ${existingBank.examId}`);
  }

  const records = await buildExamPackRecords(pack);
  const stateReset = resetStateForContentHashes.includes(existing?.contentHash);
  const stateScopes = stateReset ? [
    ['examAttempts', 'packageId', pack.manifest.packageId],
    ['examResponses', 'packageId', pack.manifest.packageId],
    ['examWrongStates', 'bankId', pack.manifest.bankId],
    ['examBookmarks', 'bankId', pack.manifest.bankId],
    ['examTranslationReviews', 'bankId', pack.manifest.bankId]
  ] : [];
  const contentScopes = ['examPapers', 'examUnits', 'examQuestions']
    .map(storeName => [storeName, 'packageId', pack.manifest.packageId]);
  const transactionStores = [...EXAM_STORES_V14, ...stateScopes.map(([storeName]) => storeName)];
  await new Promise((resolve, reject) => {
    const tx = db.transaction(transactionStores, 'readwrite');
    let failed = false;
    const fail = error => {
      if (failed) return;
      failed = true;
      reject(error);
    };
    tx.oncomplete = () => {
      if (!failed) resolve();
    };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error || new Error('exam pack 原子替换事务已中止'));

    const scopes = [...contentScopes, ...stateScopes];
    const removeNext = index => {
      if (index >= scopes.length) {
        tx.objectStore('examPackMeta').delete(pack.manifest.packageId);
        try {
          writeRecords(tx, records);
        } catch (error) {
          fail(error);
        }
        return;
      }
      const [storeName, indexName, indexValue] = scopes[index];
      deleteByIndex(tx, storeName, indexName, indexValue, () => removeNext(index + 1), fail);
    };
    removeNext(0);
  });
  return { status, packageId: pack.manifest.packageId, stateReset };
}
