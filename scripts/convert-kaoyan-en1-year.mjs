import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { convertYearSource, renderQaDocument } from '../src/exam/source-converter.mjs';

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
    const pageCount = (buffer.toString('latin1').match(/\/Type\s*\/Page\b/gu) || []).length;
    evidence.pageCount = pageCount || null;
  }
  if (kind === 'json') {
    const parsed = JSON.parse(buffer.toString('utf8'));
    evidence.topLevel = Array.isArray(parsed) ? 'array' : typeof parsed;
    evidence.blockCount = Array.isArray(parsed) ? parsed.length : Array.isArray(parsed?.pdf_info) ? parsed.pdf_info.length : null;
  }
  return evidence;
}

async function collectSourceEvidence({ sourcePath, year }) {
  const jsonPath = `D:/资料/english/json/考研英语一${year}年真题及答案解析（整卷）.json`;
  const pdfPath = `D:/资料/english/1/考研英语一${year}年真题及答案解析（整卷）.pdf`;
  const candidates = [
    await fileEvidence(sourcePath, 'markdown'),
    await fileEvidence(jsonPath, 'json'),
    await fileEvidence(pdfPath, 'pdf')
  ];
  return candidates;
}

export async function runYearConversion({ sourcePath, outputDir, year = 2025, packageVersion = '1.1.0' } = {}) {
  const resolvedSourcePath = sourcePath || `D:/资料/english/md/考研英语一${year}年真题及答案解析（整卷）.md`;
  const source = await readFile(resolve(resolvedSourcePath), 'utf8');
  const result = convertYearSource({ source, year: Number(year), packageVersion });
  const sourceEvidence = await collectSourceEvidence({ sourcePath: resolvedSourcePath, year });
  const targetDir = resolve(outputDir || `${projectRoot}/private_exam_sources/markdown/kaoyan-en1/${year}`);
  await mkdir(targetDir, { recursive: true });
  for (const unit of result.unitResults) {
    if (unit.markdown) await writeFile(resolve(targetDir, `${unit.name}.md`), unit.markdown, 'utf8');
    await writeFile(resolve(targetDir, `${unit.name}.qa.md`), renderQaDocument({
      name: unit.name,
      normalized: [
        'source-specific section boundary extracted from the year source',
        'stable question identity derived from year and section question number',
        ...(unit.name === 'part-c' ? ['writing Section III remains inventory-only'] : [])
      ],
      warnings: unit.warnings,
      blockers: unit.gate.status === 'PASS' ? [] : unit.gate.blockers,
      gate: unit.gate
    }), 'utf8');
  }
  await writeFile(resolve(targetDir, `${year}.qa-summary.md`), renderQaDocument({
    name: `${year} summary`,
    normalized: [
      `imported units: ${result.unitResults.filter(unit => unit.gate.status === 'PASS').map(unit => unit.name).join(', ')}`,
      `question count: ${result.questionCount}`,
      `source markdown: ${sourceEvidence[0].path} ${sourceEvidence[0].sha256}`,
      `source json: ${sourceEvidence[1].path} ${sourceEvidence[1].sha256} topLevel=${sourceEvidence[1].topLevel} blockCount=${sourceEvidence[1].blockCount}`,
      `source pdf: ${sourceEvidence[2].path} ${sourceEvidence[2].sha256} pageCount=${sourceEvidence[2].pageCount}`,
      `Part B variant: ${result.sourceSummary.partB.variant}`,
      `Part C questions: ${result.sourceSummary.partC.questionCount}`,
      `field coverage: ${JSON.stringify(result.fieldCoverage)}`,
      `schema gaps: ${result.schemaGaps.join(' | ')}`,
      `renderer gaps: ${result.rendererGaps.length ? result.rendererGaps.join(' | ') : 'None.'}`,
      'Section III Part A/B writing inventory-only; no writing unit was generated'
    ],
    warnings: result.warnings,
    blockers: result.blockers,
    gate: { status: result.blockers.length ? 'FAIL' : 'PASS' }
  }), 'utf8');
  if (result.blockers.length) throw new Error(`${year} conversion blocked: ${result.blockers.join('; ')}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runYearConversion({
    sourcePath: readArg('source'),
    outputDir: readArg('output-dir'),
    year: Number(readArg('year') || 2025),
    packageVersion: readArg('package-version') || '1.1.0'
  }).then(result => {
    process.stdout.write(JSON.stringify({
      year: result.meta.year,
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
