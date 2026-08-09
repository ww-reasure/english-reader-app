import test from 'node:test';
import assert from 'node:assert/strict';

import { createExamPack, hashPaper } from '../src/exam/pack.mjs';
import { assertSinglePaperOutputSafe, combineCanonicalPaperUnits, mergeExamPacks } from '../src/exam/pack-merge.mjs';

function readingPaper(paperKey, year, questionKey) {
  return {
    schemaVersion: 1,
    examId: 'kaoyan_en1',
    bankId: 'builtin_kaoyan_en1',
    packageId: 'local.kaoyan.en1',
    packageVersion: '1.0.0',
    paperKey,
    year,
    title: `${year} 考研英语一`,
    sourceType: 'past_exam',
    units: [{
      unitKey: `${paperKey}_part_a_text_1`,
      type: 'reading_mcq',
      displayTitle: 'Text 1',
      passage: [{ paragraphKey: 'P1', text: 'A source passage.' }],
      translation: [],
      questions: [{
        questionKey,
        type: 'single_choice',
        points: 2,
        answer: 'A',
        stem: 'A question?',
        options: [{ key: 'A', text: 'One' }, { key: 'B', text: 'Two' }]
      }]
    }]
  };
}

test('mergeExamPacks preserves 2026 content and adds 2025 at packageVersion 1.1.0', async () => {
  const oldPaper = readingPaper('kaoyan_en1_2026', 2026, 'kaoyan_en1_2026_q21');
  const newPaper = readingPaper('kaoyan_en1_2025', 2025, 'kaoyan_en1_2025_q21');
  const oldPack = await createExamPack({
    meta: { packageId: 'local.kaoyan.en1', packageVersion: '1.0.0', examId: 'kaoyan_en1', bankId: 'builtin_kaoyan_en1', displayName: '考研英语一' },
    papers: [oldPaper],
    generatedAt: '2026-08-07T00:00:00.000Z'
  });
  const incomingPack = await createExamPack({
    meta: { packageId: 'local.kaoyan.en1', packageVersion: '1.0.0', examId: 'kaoyan_en1', bankId: 'builtin_kaoyan_en1', displayName: '考研英语一' },
    papers: [newPaper],
    generatedAt: '2026-08-08T00:00:00.000Z'
  });
  const oldHash = await hashPaper(oldPack.papers[0]);
  const merged = await mergeExamPacks({ existingPack: oldPack, incomingPack, packageVersion: '1.1.0' });

  assert.equal(merged.manifest.packageVersion, '1.1.0');
  assert.deepEqual(merged.papers.map(paper => paper.paperKey), ['kaoyan_en1_2026', 'kaoyan_en1_2025']);
  assert.equal(await hashPaper(merged.papers[0]), oldHash);
  assert.equal(merged.manifest.papers.length, 2);
});

test('mergeExamPacks rejects duplicate paper and question identities', async () => {
  const paper2026 = readingPaper('kaoyan_en1_2026', 2026, 'kaoyan_en1_2026_q21');
  const oldPack = await createExamPack({
    meta: { packageId: 'local.kaoyan.en1', packageVersion: '1.0.0', examId: 'kaoyan_en1', bankId: 'builtin_kaoyan_en1', displayName: '考研英语一' },
    papers: [paper2026]
  });
  const duplicatePaperPack = await createExamPack({
    meta: { packageId: 'local.kaoyan.en1', packageVersion: '1.0.0', examId: 'kaoyan_en1', bankId: 'builtin_kaoyan_en1', displayName: '考研英语一' },
    papers: [readingPaper('kaoyan_en1_2026_duplicate', 2026, 'kaoyan_en1_2026_q21')]
  });
  await assert.rejects(() => mergeExamPacks({ existingPack: oldPack, incomingPack: duplicatePaperPack, packageVersion: '1.1.0' }), /questionKey/);
});

test('combineCanonicalPaperUnits creates one year paper in fixed unit order', () => {
  const first = readingPaper('kaoyan_en1_2025', 2025, 'kaoyan_en1_2025_q21');
  const second = {
    ...readingPaper('kaoyan_en1_2025', 2025, 'kaoyan_en1_2025_q22'),
    units: [{
      ...readingPaper('kaoyan_en1_2025', 2025, 'kaoyan_en1_2025_q22').units[0],
      unitKey: 'kaoyan_en1_2025_part_a_text_2'
    }]
  };
  const paper = combineCanonicalPaperUnits({ papers: [first, second], packageVersion: '1.1.0' });
  assert.equal(paper.packageVersion, '1.1.0');
  assert.deepEqual(paper.units.map(unit => unit.unitKey), ['kaoyan_en1_2025_part_a_text_1', 'kaoyan_en1_2025_part_a_text_2']);
});

test('assertSinglePaperOutputSafe blocks the legacy single-paper builder from overwriting a multi-paper pack', () => {
  assert.throws(() => assertSinglePaperOutputSafe({
    existingPack: { papers: [{ paperKey: 'kaoyan_en1_2026' }, { paperKey: 'kaoyan_en1_2025' }] },
    requestedPaperKey: 'kaoyan_en1_2024'
  }), /multi-paper|merge/i);
});

test('buildYearPack accepts only a QA-declared unsupported Part B omission', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { buildYearPack } = await import('../scripts/merge-kaoyan-en1-packs.mjs');
  const tempDir = await mkdtemp(join(tmpdir(), 'kaoyan-en1-pack-'));
  const sourceUnit = readingPaper('kaoyan_en1_2024', 2024, 'kaoyan_en1_2024_q21').units[0];
  const unitMarkdown = (name, index) => {
    const unit = {
      ...sourceUnit,
      unitKey: `kaoyan_en1_2024_${name.replaceAll('-', '_')}`,
      displayTitle: name,
      questions: [{
        ...sourceUnit.questions[0],
        questionKey: `kaoyan_en1_2024_q${21 + index}`
      }]
    };
    return [
    '# 2024 考研英语一',
    '',
    '```exam-meta',
    JSON.stringify({ schema: 'exam-md-v1', examId: 'kaoyan_en1', bankId: 'builtin_kaoyan_en1', packageId: 'local.kaoyan.en1', packageVersion: '1.1.0', paperKey: 'kaoyan_en1_2024', year: 2024, sourceType: 'past_exam' }),
    '```',
    '',
    '## Section II Part A',
    '',
    '### Text 1',
    '',
    '```exam-item',
    JSON.stringify({ unitKey: unit.unitKey, type: unit.type, displayTitle: unit.displayTitle }),
    '```',
    '',
    '#### Passage',
    '',
    '##### P1',
    unit.passage[0].text,
    '',
    '#### Q21',
    '',
    '```exam-item',
    JSON.stringify(unit.questions[0]),
    '```',
    '',
    unit.questions[0].stem,
    '',
    ...unit.questions[0].options.map(option => `- ${option.key}. ${option.text}`),
    ''
    ].join('\n');
  };
  for (const [index, name] of ['section1-cloze', 'part-a-text-1', 'part-a-text-2', 'part-a-text-3', 'part-a-text-4', 'part-c'].entries()) {
    await writeFile(join(tempDir, `${name}.md`), unitMarkdown(name, index), 'utf8');
  }
  await writeFile(join(tempDir, 'part-b.qa.md'), '# part-b QA\n\n- status: SKIPPED\n- reason: UNSUPPORTED_PART_B_VARIANT\n', 'utf8');

  const pack = await buildYearPack({ sourceDir: tempDir, packageVersion: '1.1.0' });
  assert.equal(pack.papers[0].paperKey, 'kaoyan_en1_2024');
  assert.equal(pack.papers[0].units.length, 6);
});

test('batch rebuild replaces all requested legacy years while preserving the protected 2026 paper', async () => {
  const { existsSync } = await import('node:fs');
  if (!existsSync('private_exam_sources/markdown/kaoyan-en1/2025') || !existsSync('private_exam_sources/markdown/kaoyan-en1/2024')) return;
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { rebuildKaoyanEn1Packs } = await import('../scripts/merge-kaoyan-en1-packs.mjs');
  const tempDir = await mkdtemp(join(tmpdir(), 'kaoyan-en1-batch-'));
  const existingPath = 'public/exam-packs/private/local.kaoyan.en1.json';
  const existing = JSON.parse(await readFile(existingPath, 'utf8'));
  const old2026Hash = await hashPaper(existing.papers.find(paper => paper.paperKey === 'kaoyan_en1_2026'));
  const rebuilt = await rebuildKaoyanEn1Packs({
    existingPath,
    sourceRoot: 'private_exam_sources/markdown/kaoyan-en1',
    years: [2025, 2024],
    outputPath: join(tempDir, 'local.kaoyan.en1.json'),
    indexPath: join(tempDir, 'index.json'),
    packageVersion: '1.1.1'
  });
  assert.deepEqual(rebuilt.papers.map(paper => paper.paperKey), ['kaoyan_en1_2026', 'kaoyan_en1_2025', 'kaoyan_en1_2024']);
  assert.equal(rebuilt.manifest.packageVersion, '1.1.1');
  assert.equal(await hashPaper(rebuilt.papers[0]), old2026Hash);
});
