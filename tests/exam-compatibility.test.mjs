import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';

import { build2026CompatibilityReport } from '../src/exam/compatibility.mjs';
import { parseExamMarkdown } from '../src/exam/parser.mjs';

test('build2026CompatibilityReport compares raw coverage and canonical question hashes without replacing the paper', async () => {
  const paper = {
    paperKey: 'kaoyan_en1_2026',
    units: [
      { type: 'reading_mcq', questions: [{ questionKey: 'kaoyan_en1_2026_q21', type: 'single_choice', points: 2, answer: 'A', stem: 'Question', options: [{ key: 'A', text: 'One' }, { key: 'B', text: 'Two' }] }] }
    ]
  };
  const report = await build2026CompatibilityReport({
    paper,
    rawMarkdown: '## Section II Reading Comprehension\n## Text 1\n21. Question\n## Part B\nwrong order',
    canonicalQuestions: paper.units[0].questions,
    sourceMetadata: { markdownSha256: 'sha256:md', jsonSha256: 'sha256:json' }
  });
  assert.equal(report.paperKey, 'kaoyan_en1_2026');
  assert.deepEqual(report.sourceMetadata, { markdownSha256: 'sha256:md', jsonSha256: 'sha256:json' });
  assert.equal(report.replacementPerformed, false);
  assert.equal(report.questionHashCheck.matches, true);
  assert.ok(Array.isArray(report.differences));
});

test('current 2026 raw MinerU candidate matches the verified paper coverage and canonical question hashes', { skip: !existsSync('D:/资料/english/md/MinerU_markdown_考研英语一2026年真题及答案解析（整卷）_2085746092190769152.md') }, async () => {
  const pack = JSON.parse(await readFile('public/exam-packs/private/local.kaoyan.en1.json', 'utf8'));
  const paper = pack.papers.find(item => item.paperKey === 'kaoyan_en1_2026');
  const entries = (await readdir('private_exam_sources/markdown/kaoyan-en1/2026'))
    .filter(name => name.endsWith('.md') && !name.endsWith('.qa.md'))
    .sort();
  const canonicalQuestions = [];
  for (const entry of entries) {
    const canonicalPaper = parseExamMarkdown(await readFile(`private_exam_sources/markdown/kaoyan-en1/2026/${entry}`, 'utf8'));
    canonicalQuestions.push(...canonicalPaper.units.flatMap(unit => unit.questions));
  }
  const report = await build2026CompatibilityReport({
    paper,
    rawMarkdown: await readFile('D:/资料/english/md/MinerU_markdown_考研英语一2026年真题及答案解析（整卷）_2085746092190769152.md', 'utf8'),
    canonicalQuestions
  });
  assert.equal(report.coverage.matches, true);
  assert.equal(report.questionHashCheck.matches, true);
  assert.deepEqual(report.differences, []);
  assert.equal(report.replacementPerformed, false);
});
