import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCET4Paper, metaFor } from '../src/exam/cet4-source-converter.mjs';
import { renderQaDocument } from '../src/exam/source-converter.mjs';

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function fileEvidence(path, kind) {
  const absolutePath = resolve(path);
  const buffer = await readFile(absolutePath);
  const evidence = {
    path,
    kind,
    sizeBytes: buffer.length,
    sha256: `sha256:${createHash('sha256').update(buffer).digest('hex')}`
  };
  if (kind === 'pdf') {
    evidence.pageCount = (buffer.toString('latin1').match(/\/Type\s*\/Page\b/gu) || []).length || null;
  }
  if (kind === 'json') {
    const parsed = JSON.parse(buffer.toString('utf8'));
    evidence.topLevel = Array.isArray(parsed) ? 'array' : typeof parsed;
    evidence.blockCount = Array.isArray(parsed) ? parsed.length : null;
  }
  return evidence;
}

export async function runSetConversion({
  sourcePath,
  outputDir,
  year,
  month,
  setNumber,
  packageVersion = '1.0.0'
} = {}) {
  const source = await readFile(resolve(sourcePath), 'utf8');
  const result = buildCET4Paper({ source, year: Number(year), month: Number(month), setNumber: Number(setNumber), packageVersion });
  const meta = metaFor({ year: Number(year), month: Number(month), setNumber: Number(setNumber), packageVersion });
  const targetDir = resolve(outputDir || `${projectRoot}/private_exam_sources/markdown/cet4/${meta.paperKey}`);
  await mkdir(targetDir, { recursive: true });
  for (const unit of result.unitResults) {
    if (unit.markdown && unit.gate.status === 'PASS') await writeFile(resolve(targetDir, `${unit.name}.md`), unit.markdown, 'utf8');
    await writeFile(resolve(targetDir, `${unit.name}.qa.md`), renderQaDocument({
      name: unit.name,
      normalized: [
        'CET4 source section boundary extracted from the whole paper',
        'stable question identity derived from paper and official question number'
      ],
      warnings: unit.warnings,
      blockers: unit.gate.status === 'PASS' ? [] : unit.gate.blockers,
      gate: unit.gate
    }), 'utf8');
  }
  const mdEvidence = await fileEvidence(sourcePath, 'markdown');
  const jsonPath = sourcePath.replace(/\.md$/u, '.json').replace(/\\md\\/u, '\\json\\').replace(/\/md\//u, '/json/');
  const pdfPath = sourcePath.replace(/\.md$/u, '.pdf').replace(/\\md\\/u, '\\pdf\\').replace(/\/md\//u, '/pdf/');
  let jsonEvidence = null;
  let pdfEvidence = null;
  try { jsonEvidence = await fileEvidence(jsonPath, 'json'); } catch {}
  try { pdfEvidence = await fileEvidence(pdfPath, 'pdf'); } catch {}
  await writeFile(resolve(targetDir, `${meta.paperKey}.qa-summary.md`), renderQaDocument({
    name: `${meta.paperKey} summary`,
    normalized: [
      `imported units: ${result.unitResults.filter(unit => unit.gate.status === 'PASS').map(unit => unit.name).join(', ')}`,
      `question count: ${result.questionCount}`,
      `source markdown: ${mdEvidence.path} ${mdEvidence.sha256}`,
      ...(jsonEvidence ? [`source json: ${jsonEvidence.path} ${jsonEvidence.sha256} topLevel=${jsonEvidence.topLevel} blockCount=${jsonEvidence.blockCount}`] : []),
      ...(pdfEvidence ? [`source pdf: ${pdfEvidence.path} ${pdfEvidence.sha256} pageCount=${pdfEvidence.pageCount}`] : [])
    ],
    warnings: result.warnings,
    blockers: result.blockers,
    gate: { status: result.blockers.length ? 'FAIL' : 'PASS' }
  }), 'utf8');
  if (!result.unitResults.some(unit => unit.gate.status === 'PASS')) {
    throw new Error(`${meta.paperKey} conversion blocked: ${result.blockers.join('; ')}`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runSetConversion({
    sourcePath: readArg('source'),
    outputDir: readArg('output-dir'),
    year: Number(readArg('year')),
    month: Number(readArg('month')),
    setNumber: Number(readArg('set')),
    packageVersion: readArg('package-version') || '1.0.0'
  }).then(result => {
    process.stdout.write(JSON.stringify({
      paperKey: result.paperKey,
      units: result.unitResults.filter(unit => unit.gate.status === 'PASS').map(unit => ({ name: unit.name, questions: unit.paper.units[0].questions.length })),
      questionCount: result.questionCount,
      warnings: result.warnings.length,
      blockers: result.blockers.length
    }, null, 2) + '\n');
  }).catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
