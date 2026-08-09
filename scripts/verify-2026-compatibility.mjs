import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build2026CompatibilityReport } from '../src/exam/compatibility.mjs';
import { parseExamMarkdown } from '../src/exam/parser.mjs';
import { hashPaper } from '../src/exam/pack.mjs';

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function run2026Compatibility({
  packPath = `${projectRoot}/public/exam-packs/private/local.kaoyan.en1.json`,
  rawMarkdownPath = 'D:/资料/english/md/MinerU_markdown_考研英语一2026年真题及答案解析（整卷）_2085746092190769152.md',
  rawJsonPath = 'D:/资料/english/json/MinerU_考研英语一2026年真题及答案解析（整卷）__20260807151332.json',
  canonicalDir = `${projectRoot}/private_exam_sources/markdown/kaoyan-en1/2026`,
  outputPath = `${projectRoot}/private_exam_sources/source-manifests/kaoyan-en1/2026-compatibility.qa.json`
} = {}) {
  const pack = JSON.parse(await readFile(resolve(packPath), 'utf8'));
  const paper = pack.papers.find(item => item.paperKey === 'kaoyan_en1_2026');
  if (!paper) throw new Error('现有私有 pack 缺少 kaoyan_en1_2026');
  const rawMarkdown = await readFile(resolve(rawMarkdownPath), 'utf8');
  const rawJsonStat = await import('node:fs/promises').then(fs => fs.stat(resolve(rawJsonPath)));
  const rawJson = await readFile(resolve(rawJsonPath));
  const { createHash } = await import('node:crypto');
  const hashBuffer = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
  const canonicalEntries = (await readdir(resolve(canonicalDir)))
    .filter(name => name.endsWith('.md') && !name.endsWith('.qa.md'))
    .sort();
  const canonicalQuestions = [];
  for (const entry of canonicalEntries) {
    const canonicalPaper = parseExamMarkdown(await readFile(resolve(canonicalDir, entry), 'utf8'));
    canonicalQuestions.push(...canonicalPaper.units.flatMap(unit => unit.questions));
  }
  const report = await build2026CompatibilityReport({
    paper,
    rawMarkdown,
    canonicalQuestions,
    sourceMetadata: {
      markdownPath: rawMarkdownPath,
      jsonPath: rawJsonPath,
      markdownSha256: hashBuffer(Buffer.from(rawMarkdown)),
      jsonSha256: hashBuffer(rawJson),
      jsonSizeBytes: rawJsonStat.size,
      existingPaperHash: await hashPaper(paper),
      canonicalFiles: canonicalEntries
    }
  });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  await import('node:fs/promises').then(fs => fs.mkdir(dirname(resolve(outputPath)), { recursive: true }));
  await import('node:fs/promises').then(fs => fs.writeFile(resolve(outputPath), output, 'utf8'));
  process.stdout.write(JSON.stringify({
    paperKey: report.paperKey,
    existingPaperHash: report.existingPaperHash,
    questionHashMatches: report.questionHashCheck.matches,
    coverageMatches: report.coverage.matches,
    differences: report.differences.length,
    replacementPerformed: report.replacementPerformed
  }, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run2026Compatibility({
    packPath: readArg('pack') || undefined,
    rawMarkdownPath: readArg('markdown') || undefined,
    rawJsonPath: readArg('json') || undefined,
    canonicalDir: readArg('canonical-dir') || undefined,
    outputPath: readArg('output') || undefined
  }).catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
