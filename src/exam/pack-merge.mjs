import { assertCanonicalPaper } from './schema.mjs';
import { assertExamPack, createExamPack } from './pack.mjs';

function collectIdentity(papers, field, label) {
  const seen = new Map();
  for (const paper of papers) {
    for (const unit of paper.units) {
      if (field === 'unitKey') {
        const key = unit.unitKey;
        if (seen.has(key)) throw new Error(`pack merge duplicate unitKey: ${key}`);
        seen.set(key, paper.paperKey);
        continue;
      }
      for (const question of unit.questions) {
        const key = question.questionKey;
        if (seen.has(key)) throw new Error(`pack merge duplicate questionKey: ${key}`);
        seen.set(key, `${paper.paperKey}/${unit.unitKey}`);
      }
    }
  }
  return seen;
}

export function combineCanonicalPaperUnits({ papers, packageVersion }) {
  if (!Array.isArray(papers) || !papers.length) throw new Error('paper units 至少需要一个来源');
  const first = papers[0];
  for (const paper of papers) {
    for (const field of ['examId', 'bankId', 'packageId', 'paperKey', 'year']) {
      if (paper[field] !== first[field]) throw new Error(`paper ${field} 不一致`);
    }
  }
  const units = papers.flatMap(paper => paper.units || []);
  const unitKeys = new Set();
  for (const unit of units) {
    if (unitKeys.has(unit.unitKey)) throw new Error(`duplicate unitKey: ${unit.unitKey}`);
    unitKeys.add(unit.unitKey);
  }
  return assertCanonicalPaper({
    ...first,
    packageVersion: packageVersion || first.packageVersion,
    units
  });
}

export function assertSinglePaperOutputSafe({ existingPack, requestedPaperKey }) {
  const papers = Array.isArray(existingPack?.papers) ? existingPack.papers : [];
  if (papers.length > 1) {
    throw new Error('拒绝 single-paper builder 覆盖 multi-paper pack；请使用 merge tool');
  }
  if (papers.length === 1 && papers[0].paperKey !== requestedPaperKey) {
    throw new Error('拒绝 single-paper builder 覆盖包含其他 paper 的 pack；请使用 merge tool');
  }
  return true;
}

export async function mergeExamPacks({ existingPack, incomingPack, packageVersion = '1.1.0', generatedAt }) {
  await assertExamPack(existingPack);
  await assertExamPack(incomingPack);

  const existingManifest = existingPack.manifest;
  const incomingManifest = incomingPack.manifest;
  for (const field of ['packageId', 'examId', 'bankId']) {
    if (existingManifest[field] !== incomingManifest[field]) {
      throw new Error(`pack merge ${field} 不一致`);
    }
  }

  const existingPaperKeys = new Set(existingPack.papers.map(paper => paper.paperKey));
  const combinedPapers = [...existingPack.papers];
  const allPaperKeys = new Set();
  for (const paper of existingPack.papers) {
    if (allPaperKeys.has(paper.paperKey)) throw new Error(`pack merge duplicate paperKey: ${paper.paperKey}`);
    allPaperKeys.add(paper.paperKey);
  }
  for (const paper of incomingPack.papers) {
    assertCanonicalPaper(paper);
    if (existingPaperKeys.has(paper.paperKey) || allPaperKeys.has(paper.paperKey)) {
      throw new Error(`pack merge duplicate paperKey: ${paper.paperKey}`);
    }
    allPaperKeys.add(paper.paperKey);
    combinedPapers.push(paper);
  }

  collectIdentity(combinedPapers, 'unitKey', 'unitKey');
  collectIdentity(combinedPapers, 'questionKey', 'questionKey');

  return createExamPack({
    meta: {
      packageId: existingManifest.packageId,
      packageVersion,
      examId: existingManifest.examId,
      bankId: existingManifest.bankId,
      displayName: existingManifest.displayName
    },
    papers: combinedPapers,
    generatedAt: generatedAt || new Date().toISOString()
  });
}
