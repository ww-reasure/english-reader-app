import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('practice view flushes pending autosave before submit, exit and route cleanup', async () => {
  const source = await readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8');
  assert.match(source, /async cleanup\(\)/);
  assert.match(source, /await this\.flushAutosave\(\)/);
  assert.match(source, /async submit\(\)/);
  assert.match(source, /await this\.flushAutosave\(\)/);
  assert.match(source, /this\.attempt = result\.attempt/);
  assert.match(source, /this\._disposed = true/);
  assert.match(source, /_submitting/);
});

test('practice shell delegates article and question rendering to shared renderers', async () => {
  const [viewSource, registrySource] = await Promise.all([
    readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/exam/renderers/registry.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(viewSource, /getExamRenderer/);
  assert.match(viewSource, /this\.renderer\.renderArticle/);
  assert.match(viewSource, /this\.renderer\.renderQuestion/);
  assert.match(registrySource, /readingMcqRenderer\.unitType/);
  assert.match(registrySource, /clozeRenderer\.unitType/);
  assert.match(registrySource, /paragraphOrderingRenderer\.unitType/);
});

test('submitted attempts open a read-only explanation mode in the shared practice shell', async () => {
  const [practiceSource, resultSource, routerSource, detailSource] = await Promise.all([
    readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/exam-result.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/router.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/exam/renderers/result-detail.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(practiceSource, /renderSubmittedExplanation/);
  assert.match(detailSource, /在原文中查看/);
  assert.match(practiceSource, /题库内容此后有更新/);
  assert.match(resultSource, /查看解析/);
  assert.match(resultSource, /examOpenExplanations/);
  assert.match(routerSource, /explanation/);
});

test('submitted explanation checks every question hash before showing a content-update notice', async () => {
  const source = await readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /this\.questions\.some\(async question/);
  assert.match(source, /await Promise\.all\(this\.questions\.map\(async question/);
  assert.match(source, /\)\.some\(Boolean\)/);
});

test('leaving explanation mode clears its transient state before a new draft render', async () => {
  const source = await readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8');
  assert.match(source, /this\.isExplanation = false;/);
  assert.match(source, /clearTimeout\(this\._evidenceHighlightTimer\)/);
});

test('result summary keeps a readable duration and puts the user ordering before the answer ordering', async () => {
  const source = await readFile(new URL('../src/views/exam-result.js', import.meta.url), 'utf8');
  assert.match(source, /function formatDuration/);
  assert.match(source, /有效用时<\/span>/);
  assert.match(source, /你的顺序/);
  assert.match(source, /正确顺序/);
  assert.ok(source.indexOf('你的顺序') < source.indexOf('正确顺序'));
});

test('evidence navigation lowers the shared sheet and temporarily highlights its passage paragraph', async () => {
  const source = await readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8');
  assert.match(source, /jumpToEvidence\(location\)/);
  assert.match(source, /this\.setSnap\('low'\)/);
  assert.match(source, /target\.scrollIntoView/);
  assert.match(source, /is-evidence-highlight/);
});

test('submitted explanation exposes an explicit Exam Tutor trigger without touching draft practice', async () => {
  const [source, dialogSource] = await Promise.all([
    readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/exam/exam-tutor-dialog.js', import.meta.url), 'utf8')
  ]);
  const draftMethod = source.slice(source.indexOf('  renderQuestion()'), source.indexOf('  renderSubmittedQuestion()'));
  assert.match(source, /createExamTutorService/);
  assert.match(source, /ExamTutorDialog/);
  assert.match(source, /examTutorOpen/);
  assert.match(source, /openExamTutor/);
  assert.match(dialogSource, /EXAM_TUTOR_INITIAL_PROMPT/);
  assert.match(dialogSource, /renderLearningMarkdown/);
  assert.match(dialogSource, /examTutorRetry/);
  assert.match(dialogSource, /examTutorMessages/);
  assert.match(dialogSource, /async send\(message\)/);
  assert.doesNotMatch(draftMethod, /ExamTutor|examTutor/);
});

test('Exam Tutor modal keeps recovery and retry inside the explanation view boundary', async () => {
  const [source, dialogSource] = await Promise.all([
    readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/exam/exam-tutor-dialog.js', import.meta.url), 'utf8')
  ]);
  assert.match(dialogSource, /getConversation\(/);
  assert.match(dialogSource, /catch \(requestError\)/);
  assert.match(dialogSource, /examTutorError/);
  assert.match(dialogSource, /重新发送/);
  assert.match(source, /examTutorDialog\?\.destroy\(\)/);
  assert.doesNotMatch(source, /from ['"].*ai-analysis/);
});

test('result detail reuses the exam-local tutor dialog for each submitted question', async () => {
  const source = await readFile(new URL('../src/views/exam-result.js', import.meta.url), 'utf8');
  assert.match(source, /createExamTutorService/);
  assert.match(source, /ExamTutorDialog/);
  assert.match(source, /exam-tutor-open/);
  assert.match(source, /open\(\{ attempt, response, question, unit \}\)/);
  assert.doesNotMatch(source, /from ['"].*ai-analysis/);
});

test('submitted result and explanation bind text selection actions, while draft practice does not', async () => {
  const [resultSource, practiceSource, dialogSource, selectionSource] = await Promise.all([
    readFile(new URL('../src/views/exam-result.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/exam/exam-tutor-dialog.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/exam/selectable-text-actions.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(resultSource, /SelectableTextActions/);
  assert.match(resultSource, /quote/);
  assert.match(practiceSource, /SelectableTextActions/);
  assert.match(practiceSource, /this.isExplanation/);
  assert.match(dialogSource, /ai_message/);
  assert.match(selectionSource, /removeEventListener/);
  assert.match(selectionSource, /destroy()/);
  const draftMethod = practiceSource.slice(practiceSource.indexOf('  renderQuestion()'), practiceSource.indexOf('  renderSubmittedQuestion()'));
  assert.doesNotMatch(draftMethod, /SelectableTextActions/);
});

test('draft and submitted explanation reuse the shared reading-style word lookup binding', async () => {
  const [practiceSource, lookupSource] = await Promise.all([
    readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/reading-word-lookup.js', import.meta.url), 'utf8')
  ]);
  assert.match(practiceSource, /bindReadingStyleWordLookup/);
  assert.ok((practiceSource.match(/this\.bindExamWordLookup\(\)/g) || []).length >= 2);
  assert.match(practiceSource, /id="wordTooltip" class="word-tooltip"/);
  assert.match(lookupSource, /Tooltip\.beginLookup/);
  assert.match(lookupSource, /Dictionary\.lookup/);
  assert.match(lookupSource, /ContextualSense\.resolve/);
  assert.match(lookupSource, /Tooltip\.attachAutoDismiss/);
  assert.match(lookupSource, /Tooltip\.isCurrent/);
  assert.match(lookupSource, /return \(\) =>/);
});

test('exam word lookup ignores answer controls and never records reading evidence', async () => {
  const [practiceSource, lookupSource] = await Promise.all([
    readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/reading-word-lookup.js', import.meta.url), 'utf8')
  ]);
  assert.match(lookupSource, /button, a, input, textarea, select, \[role="button"\]/);
  assert.match(practiceSource, /querySelectorAll\('\[data-key\]'\)/);
  assert.match(practiceSource, /selectAnswer\(button\.dataset\.key\)/);
  assert.doesNotMatch(practiceSource, /knowledgeEvidenceBridge/);
  assert.doesNotMatch(lookupSource, /knowledgeEvidenceBridge/);
});

test('exam lookup cleanup hides stale tooltips while preserving explanation Ask AI behavior', async () => {
  const source = await readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8');
  assert.match(source, /this\._wordLookupCleanup\?\.\(\)/);
  assert.match(source, /allowAskAI: true/);
  assert.match(source, /onAskAI: async quote/);
  assert.match(source, /openTranslationTutor\(\{ quote \}\)/);
  assert.match(source, /examTutorDialog\?\.open\(\{ \.\.\.this\.getExamTutorInput\(\), quote \}\)/);
});
