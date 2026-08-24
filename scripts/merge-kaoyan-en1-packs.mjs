import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createExamPack, assertExamPack, hashPaper } from '../src/exam/pack.mjs';
import { combineCanonicalPaperUnits, mergeExamPacks } from '../src/exam/pack-merge.mjs';
import { parseExamMarkdown } from '../src/exam/parser.mjs';
import { hasTeachingAppendixMarker, sanitizeReadingUnitAnalyses, trimOptionAnalysisTail } from '../src/exam/option-analysis-sanitizer.mjs';

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const unitOrder = ['section1-cloze', 'part-a-text-1', 'part-a-text-2', 'part-a-text-3', 'part-a-text-4', 'part-b', 'part-c'];

async function isUnsupportedPartBSkipped(dir) {
  try {
    const qa = await readFile(resolve(dir, 'part-b.qa.md'), 'utf8');
    return /status:\s*SKIPPED/u.test(qa) && /UNSUPPORTED_PART_B_VARIANT/u.test(qa);
  } catch {
    return false;
  }
}

async function safeWriteJson(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

function sanitizeReadingOptionAnalyses(paper) {
  return {
    ...paper,
    units: paper.units.map(unit => sanitizeReadingUnitAnalyses(unit, { label: `${paper.paperKey}:${unit.unitKey}` }))
  };
}

function assertOnlyTeachingAppendixTailChanged(original, sanitized) {
  const originalQuestions = new Map(original.units.flatMap(unit => unit.type === 'reading_mcq'
    ? unit.questions.map(question => [`${unit.unitKey}:${question.questionKey}`, question])
    : []));
  for (const unit of sanitized.units.filter(item => item.type === 'reading_mcq')) {
    for (const question of unit.questions) {
      const before = originalQuestions.get(`${unit.unitKey}:${question.questionKey}`);
      if (!before) throw new Error(`2026 重建缺少原题：${question.questionKey}`);
      const analysisFields = ['stemAnalysis', 'explanation', 'evidence', 'evidenceTranslation'];
      const beforeRest = Object.fromEntries(Object.entries(before).filter(([key]) => !['optionAnalysis', ...analysisFields].includes(key)));
      const afterRest = Object.fromEntries(Object.entries(question).filter(([key]) => !['optionAnalysis', ...analysisFields].includes(key)));
      if (JSON.stringify(beforeRest) !== JSON.stringify(afterRest)) {
        throw new Error(`2026 ${question.questionKey} 出现非选项解析改动，拒绝写入`);
      }
      for (const field of analysisFields) {
        const raw = before[field];
        const expected = hasTeachingAppendixMarker(raw) ? trimOptionAnalysisTail(raw) : raw;
        if (question[field] !== expected) throw new Error(`2026 ${question.questionKey}.${field} 超出已识别附录尾巴，拒绝写入`);
      }
      const beforeOptions = new Map((before.optionAnalysis || []).map(item => [item.key, item.text]));
      for (const option of question.optionAnalysis || []) {
        const raw = beforeOptions.get(option.key);
        const expected = hasTeachingAppendixMarker(raw) ? trimOptionAnalysisTail(raw) : String(raw || '').trim();
        if (option.text !== expected) throw new Error(`2026 ${question.questionKey} ${option.key} 的解析超出已识别附录尾巴，拒绝写入`);
      }
    }
  }
}

export async function buildYearPack({ sourceDir, packageVersion = '1.1.0' }) {
  const dir = resolve(sourceDir);
  const available = new Set(await readdir(dir));
  const papers = [];
  for (const unitName of unitOrder) {
    const filename = `${unitName}.md`;
    if (!available.has(filename)) {
      if (unitName === 'part-b' && await isUnsupportedPartBSkipped(dir)) continue;
      throw new Error(`缺少已通过 gate 的 unit：${filename}`);
    }
    papers.push(parseExamMarkdown(await readFile(resolve(dir, filename), 'utf8')));
  }
  const paper = combineCanonicalPaperUnits({ papers, packageVersion });
  return createExamPack({
    meta: {
      packageId: paper.packageId,
      packageVersion,
      examId: paper.examId,
      bankId: paper.bankId,
      displayName: `${paper.year} 考研英语一`
    },
    papers: [paper]
  });
}

export async function rebuildKaoyanEn1Packs({
  existingPath = `${projectRoot}/public/exam-packs/private/local.kaoyan.en1.json`,
  sourceRoot = `${projectRoot}/private_exam_sources/markdown/kaoyan-en1`,
  years = Array.from({ length: 16 }, (_, index) => 2025 - index),
  outputPath = existingPath,
  indexPath = `${projectRoot}/public/exam-packs/private/index.json`,
  packageVersion = '1.1.3'
} = {}) {
  const rawExistingPack = JSON.parse(await readFile(resolve(existingPath), 'utf8'));
  const existingPack = { ...rawExistingPack, papers: rawExistingPack.papers.map(sanitizeReadingOptionAnalyses) };
  const rawProtectedPaper = rawExistingPack.papers.find(paper => paper.paperKey === 'kaoyan_en1_2026');
  const protectedPaper = existingPack.papers.find(paper => paper.paperKey === 'kaoyan_en1_2026');
  if (!protectedPaper) throw new Error('现有 pack 缺少受保护的 2026 paper');
  assertOnlyTeachingAppendixTailChanged(rawProtectedPaper, protectedPaper);
  const protectedHash = await hashPaper(protectedPaper);
  let rebuilt = await createExamPack({
    meta: {
      packageId: existingPack.manifest.packageId,
      packageVersion,
      examId: existingPack.manifest.examId,
      bankId: existingPack.manifest.bankId,
      displayName: existingPack.manifest.displayName
    },
    papers: [protectedPaper]
  });
  for (const year of years) {
    const incomingPack = await buildYearPack({ sourceDir: resolve(sourceRoot, String(year)), packageVersion });
    rebuilt = await mergeExamPacks({ existingPack: rebuilt, incomingPack, packageVersion });
  }
  await assertExamPack(rebuilt);
  const rebuiltProtected = rebuilt.papers.find(paper => paper.paperKey === protectedPaper.paperKey);
  if (await hashPaper(rebuiltProtected) !== protectedHash) throw new Error('2026 paper hash 被改变，拒绝写入');
  await safeWriteJson(outputPath, rebuilt);

  let index = { schemaVersion: 1, packs: [] };
  try { index = JSON.parse(await readFile(resolve(indexPath), 'utf8')); } catch {}
  const packs = [
    ...(Array.isArray(index.packs) ? index.packs : []).filter(item => item.packageId !== rebuilt.manifest.packageId),
    { packageId: rebuilt.manifest.packageId, path: `/exam-packs/private/${rebuilt.manifest.packageId}.json` }
  ];
  await safeWriteJson(indexPath, { schemaVersion: 1, packs });
  process.stdout.write(JSON.stringify({
    outputPath: resolve(outputPath),
    packageVersion: rebuilt.manifest.packageVersion,
    papers: rebuilt.papers.length,
    preserved2026Hash: protectedHash
  }, null, 2) + '\n');
  return rebuilt;
}

export async function mergeKaoyanEn1Packs({
  existingPath = `${projectRoot}/public/exam-packs/private/local.kaoyan.en1.json`,
  sourceDir = `${projectRoot}/private_exam_sources/markdown/kaoyan-en1/2025`,
  outputPath = existingPath,
  indexPath = `${projectRoot}/public/exam-packs/private/index.json`,
  packageVersion = '1.1.0',
  rebuildIncoming = false
} = {}) {
  const existingPack = JSON.parse(await readFile(resolve(existingPath), 'utf8'));
  await assertExamPack(existingPack);
  const oldPaper = existingPack.papers.find(paper => paper.paperKey === 'kaoyan_en1_2026');
  if (!oldPaper) throw new Error('现有 pack 缺少 2026 paper');
  const oldHash = await hashPaper(oldPaper);
  const incomingPack = await buildYearPack({ sourceDir, packageVersion });
  const mergeBase = rebuildIncoming
    ? await createExamPack({
      meta: {
        packageId: existingPack.manifest.packageId,
        packageVersion: existingPack.manifest.packageVersion,
        examId: existingPack.manifest.examId,
        bankId: existingPack.manifest.bankId,
        displayName: existingPack.manifest.displayName
      },
      papers: [oldPaper]
    })
    : existingPack;
  const merged = await mergeExamPacks({ existingPack: mergeBase, incomingPack, packageVersion });
  await assertExamPack(merged);
  const mergedOldPaper = merged.papers.find(paper => paper.paperKey === 'kaoyan_en1_2026');
  if (await hashPaper(mergedOldPaper) !== oldHash) throw new Error('2026 paper hash 被改变，拒绝写入');
  await safeWriteJson(outputPath, merged);

  let index = { schemaVersion: 1, packs: [] };
  try { index = JSON.parse(await readFile(resolve(indexPath), 'utf8')); } catch {}
  const packs = [
    ...(Array.isArray(index.packs) ? index.packs : []).filter(item => item.packageId !== merged.manifest.packageId),
    { packageId: merged.manifest.packageId, path: `/exam-packs/private/${merged.manifest.packageId}.json` }
  ];
  await safeWriteJson(indexPath, { schemaVersion: 1, packs });
  process.stdout.write(JSON.stringify({
    outputPath: resolve(outputPath),
    packageVersion: merged.manifest.packageVersion,
    papers: merged.papers.map(paper => ({ paperKey: paper.paperKey, units: paper.units.length, questions: paper.units.reduce((total, unit) => total + unit.questions.length, 0) })),
    preserved2026Hash: oldHash
  }, null, 2) + '\n');
  return merged;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv.includes('--rebuild-all') ? rebuildKaoyanEn1Packs : mergeKaoyanEn1Packs;
  command({
    existingPath: readArg('existing') || undefined,
    sourceDir: readArg('source-dir') || undefined,
    sourceRoot: readArg('source-root') || undefined,
    outputPath: readArg('output') || undefined,
    indexPath: readArg('index') || undefined,
    packageVersion: readArg('package-version') || (process.argv.includes('--rebuild-all') ? '1.1.3' : '1.1.0'),
    rebuildIncoming: process.argv.includes('--rebuild-incoming')
  }).catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
