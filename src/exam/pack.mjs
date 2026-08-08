import { EXAM_PACK_SCHEMA_VERSION } from './constants.mjs';
import { assertCanonicalPaper, assertExamPackShape } from './schema.mjs';
import { parseExamMarkdown } from './parser.mjs';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value)
    .filter(key => value[key] !== undefined)
    .sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function contentHashOf(value) {
  return `sha256:${await sha256Hex(stableStringify(value))}`;
}

export async function hashQuestion(question) {
  return contentHashOf({
    type: question.type,
    points: question.points,
    answer: question.answer,
    stem: question.stem,
    options: question.options,
    questionTranslation: question.questionTranslation || '',
    questionType: question.questionType || '',
    stemAnalysis: question.stemAnalysis || '',
    location: question.location || '',
    evidence: question.evidence || '',
    evidenceTranslation: question.evidenceTranslation || '',
    explanation: question.explanation || '',
    optionAnalysis: question.optionAnalysis || [],
    optionTranslations: question.optionTranslations || [],
    blankNumber: question.blankNumber || null,
    slotNumber: question.slotNumber || null,
    segmentKey: question.segmentKey || null,
    sourceText: question.sourceText || '',
    referenceTranslation: question.referenceTranslation || '',
    localAnalysis: question.localAnalysis || ''
  });
}

export async function hashPaper(paper) {
  return contentHashOf({
    schemaVersion: paper.schemaVersion,
    examId: paper.examId,
    bankId: paper.bankId,
    paperKey: paper.paperKey,
    year: paper.year,
    title: paper.title,
    sourceType: paper.sourceType,
    units: paper.units
  });
}

function questionCount(paper) {
  return paper.units.reduce((total, unit) => total + unit.questions.length, 0);
}

async function buildManifest(meta, papers, generatedAt) {
  const paperHashes = [];
  for (const paper of papers) {
    paperHashes.push({
      paperKey: paper.paperKey,
      contentHash: await hashPaper(paper)
    });
  }
  const contentHash = await contentHashOf({
    schemaVersion: EXAM_PACK_SCHEMA_VERSION,
    packageId: meta.packageId,
    packageVersion: meta.packageVersion,
    examId: meta.examId,
    bankId: meta.bankId,
    papers: paperHashes
  });
  return {
    schemaVersion: EXAM_PACK_SCHEMA_VERSION,
    packageId: meta.packageId,
    packageVersion: meta.packageVersion,
    examId: meta.examId,
    bankId: meta.bankId,
    displayName: meta.displayName,
    contentHash,
    generatedAt: generatedAt || new Date().toISOString(),
    papers: papers.map((paper, index) => ({
      paperKey: paper.paperKey,
      year: paper.year,
      path: `papers/${paper.paperKey}.json`,
      contentHash: paperHashes[index].contentHash,
      unitCount: paper.units.length,
      questionCount: questionCount(paper)
    }))
  };
}

export async function createExamPack({ meta, papers, generatedAt }) {
  if (!meta || typeof meta !== 'object') throw new Error('Exam Pack meta 必须提供');
  if (!Array.isArray(papers) || !papers.length) throw new Error('Exam Pack 至少需要一个 paper');
  papers.forEach(assertCanonicalPaper);
  const pack = {
    manifest: await buildManifest(meta, papers, generatedAt),
    papers
  };
  return assertExamPack(pack);
}

export async function assertExamPack(pack) {
  assertExamPackShape(pack);
  const { manifest, papers } = pack;
  for (let index = 0; index < papers.length; index += 1) {
    const paper = papers[index];
    const expected = manifest.papers[index];
    const actual = await hashPaper(paper);
    if (expected?.paperKey !== paper.paperKey) {
      throw new Error(`Exam Pack 无效：manifest.papers[${index}].paperKey 与 paper 不一致`);
    }
    if (expected?.contentHash !== actual) {
      throw new Error(`Exam Pack 无效：paper ${paper.paperKey} contentHash 不匹配`);
    }
  }
  const packageHash = await contentHashOf({
    schemaVersion: manifest.schemaVersion,
    packageId: manifest.packageId,
    packageVersion: manifest.packageVersion,
    examId: manifest.examId,
    bankId: manifest.bankId,
    papers: manifest.papers.map(paper => ({ paperKey: paper.paperKey, contentHash: paper.contentHash }))
  });
  if (manifest.contentHash !== packageHash) {
    throw new Error('Exam Pack 无效：manifest.contentHash 不匹配');
  }
  return pack;
}

export async function buildExamPackFromMarkdown(markdown, options = {}) {
  const paper = parseExamMarkdown(markdown);
  return createExamPack({
    meta: {
      packageId: paper.packageId,
      packageVersion: paper.packageVersion,
      examId: paper.examId,
      bankId: paper.bankId,
      displayName: options.displayName || paper.title
    },
    papers: [paper],
    generatedAt: options.generatedAt
  });
}
