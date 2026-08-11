import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createExamPack, assertExamPack } from '../src/exam/pack.mjs';
import { combineCanonicalPaperUnits, mergeExamPacks } from '../src/exam/pack-merge.mjs';
import { parseExamMarkdown } from '../src/exam/parser.mjs';
import { runSetConversion } from './convert-cet4-set.mjs';

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const MD_ROOT = 'D:/资料/english/CET4/md';
const UNIT_ORDER = ['section-a', 'section-b', 'section-c-1', 'section-c-2', 'translation'];
const FILE_PATTERN = /英语四级(20\d{2})年(\d{1,2})月第(\d)套真题及答案解析（整卷）(?: \(1\))?\.md$/u;

function paperParts(filename) {
  const match = String(filename || '').match(FILE_PATTERN);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), setNumber: Number(match[3]) };
}

async function safeWriteJson(path, value) {
  const target = resolve(path);
  await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

async function buildYearPack({ paperKey, packageVersion = '1.0.0' }) {
  const dir = resolve(projectRoot, 'private_exam_sources/markdown/cet4', paperKey);
  const papers = [];
  for (const unitName of UNIT_ORDER) {
    try {
      const markdown = await readFile(resolve(dir, `${unitName}.md`), 'utf8');
      papers.push(parseExamMarkdown(markdown));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  if (!papers.length) throw new Error(`${paperKey} 没有可合入的 unit`);
  const paper = combineCanonicalPaperUnits({ papers, packageVersion });
  return createExamPack({
    meta: {
      packageId: paper.packageId,
      packageVersion,
      examId: paper.examId,
      bankId: paper.bankId,
      displayName: `${paper.year} 英语四级`
    },
    papers: [paper]
  });
}

export async function runCET4Batch({
  sourceRoot = MD_ROOT,
  outputPath = `${projectRoot}/public/exam-packs/private/local.cet4.json`,
  indexPath = `${projectRoot}/public/exam-packs/private/index.json`,
  packageVersion = '1.0.0',
  verifyOnly = false
} = {}) {
  const files = (await readdir(sourceRoot)).filter(name => name.endsWith('.md'));
  const converted = [];
  const skipped = [];
  for (const filename of files.sort()) {
    const parts = paperParts(filename);
    if (!parts) { skipped.push({ filename, reason: 'UNRECOGNIZED_FILENAME' }); continue; }
    const paperKey = `cet4_${parts.year}_${String(parts.month).padStart(2, '0')}_${parts.setNumber}`;
    try {
      const result = await runSetConversion({
        sourcePath: resolve(sourceRoot, filename),
        year: parts.year,
        month: parts.month,
        setNumber: parts.setNumber,
        packageVersion
      });
      const units = result.unitResults.map(u => ({ name: u.name, status: u.gate.status }));
      const passedNames = new Set(units.filter(u => u.status === 'PASS').map(u => u.name));
      const coreMissing = ['section-b', 'section-c-1', 'section-c-2'].filter(name => !passedNames.has(name));
      if (coreMissing.length) {
        skipped.push({ paperKey, filename, reason: 'CORE_READING_UNITS_MISSING:' + coreMissing.join(',') });
      } else {
        converted.push({ paperKey, filename, questionCount: result.questionCount, units });
      }
    } catch (error) {
      skipped.push({ paperKey, filename, reason: String(error.message).split('\n')[0] });
    }
  }
  if (verifyOnly) {
    return { converted, skipped, packageVersion };
  }

  let pack = null;
  const sortedConverted = converted.sort((a, b) => a.paperKey.localeCompare(b.paperKey));
  for (const item of sortedConverted) {
    const incoming = await buildYearPack({ paperKey: item.paperKey, packageVersion });
    pack = pack ? await mergeExamPacks({ existingPack: pack, incomingPack: incoming, packageVersion }) : incoming;
  }
  if (!pack) throw new Error('CET4 没有可合入的 paper');
  await assertExamPack(pack);
  await safeWriteJson(outputPath, pack);
  let index = { schemaVersion: 1, packs: [] };
  try { index = JSON.parse(await readFile(resolve(indexPath), 'utf8')); } catch {}
  const packs = [
    ...(Array.isArray(index.packs) ? index.packs : []).filter(item => item.packageId !== pack.manifest.packageId),
    { packageId: pack.manifest.packageId, path: `/exam-packs/private/${pack.manifest.packageId}.json` }
  ];
  await safeWriteJson(indexPath, { schemaVersion: 1, packs });
  return {
    converted: sortedConverted,
    skipped,
    packageVersion: pack.manifest.packageVersion,
    papers: pack.papers.length,
    outputPath: resolve(outputPath)
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCET4Batch({
    outputPath: readArg('output') || undefined,
    indexPath: readArg('index') || undefined,
    packageVersion: readArg('package-version') || '1.0.0',
    verifyOnly: process.argv.includes('--verify-only')
  }).then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }).catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
