import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createExamPack } from '../src/exam/pack.mjs';
import { parseExamMarkdown } from '../src/exam/parser.mjs';
import { assertSinglePaperOutputSafe } from '../src/exam/pack-merge.mjs';

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function runCli() {
  const input = readArg('input');
  const output = readArg('output');
  if (!input) throw new Error('缺少 --input <markdown file>');
  const markdown = await readFile(resolve(input), 'utf8');
  const paper = parseExamMarkdown(markdown);
  const pack = await createExamPack({
    meta: {
      packageId: paper.packageId,
      packageVersion: paper.packageVersion,
      examId: paper.examId,
      bankId: paper.bankId,
      displayName: paper.title
    },
    papers: [paper],
    generatedAt: new Date().toISOString()
  });
  const outputPath = resolve(output || `public/exam-packs/private/${pack.manifest.packageId}.json`);
  try {
    const previousPack = JSON.parse(await readFile(outputPath, 'utf8'));
    assertSinglePaperOutputSafe({ existingPack: previousPack, requestedPaperKey: paper.paperKey });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(resolve(outputPath, '..'), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');

  const indexPath = resolve('public/exam-packs/private/index.json');
  let previous = { packs: [] };
  try {
    previous = JSON.parse(await readFile(indexPath, 'utf8'));
  } catch {}
  const packs = [
    ...(Array.isArray(previous.packs) ? previous.packs : []).filter(item => item.packageId !== pack.manifest.packageId),
    { packageId: pack.manifest.packageId, path: `/exam-packs/private/${pack.manifest.packageId}.json` }
  ];
  await writeFile(indexPath, `${JSON.stringify({ schemaVersion: 1, packs }, null, 2)}\n`, 'utf8');
  process.stdout.write(`已生成 Exam Pack：${outputPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
