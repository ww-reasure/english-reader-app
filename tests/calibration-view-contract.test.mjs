import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the assessment route uses the offline adaptive calibration flow instead of replacing the target exam', async () => {
  const [router, view] = await Promise.all([
    readFile(new URL('../src/router.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/calibration.js', import.meta.url), 'utf8')
  ]);

  assert.match(router, /import \{ CalibrationView \} from '\.\/views\/calibration\.js';/);
  assert.match(router, /case hash === '#\/assessment':\s*\n\s*view = CalibrationView;/);
  assert.match(view, /CALIBRATION_WORD_QUESTION_COUNT/);
  assert.match(view, /createCalibrationSession/);
  assert.match(view, /recommendCalibrationMode/);
  assert.match(view, /createKnowledgeProfileRepository/);
  assert.match(view, /24 道分层自适应词义题/);
  // Target labels come from the shared track registry so all routes use the
  // same English I / English II names rather than maintaining a second copy.
  assert.match(view, /listSelectableTracks/);
  assert.match(view, /targetTrack/);
  assert.match(view, /calibrationAttemptId/);
  assert.match(view, /band:\s*question\.frequencyBand/);
  assert.match(view, /跳过，先保守阅读/);
  assert.match(view, /材料目标覆盖/);
  assert.match(view, /证据收集中/);
  assert.doesNotMatch(view, /预计掌握覆盖/);
  assert.doesNotMatch(view, /Config\.set\('exam_level',\s*result\.recommended/);
});

test('keeps an incomplete offline calibration bank in an explicitly conservative partial-stratification mode', async () => {
  const view = await readFile(new URL('../src/views/calibration.js', import.meta.url), 'utf8');

  assert.match(view, /session\.stratification\.status === 'partial'/);
  assert.match(view, /部分词频层审核条目不足/);
  assert.match(view, /不会把本次结果表述为完整分层校准/);
});

test('requires an explicit target selection before a new or migrated learner can calibrate or skip', async () => {
  const view = await readFile(new URL('../src/views/calibration.js', import.meta.url), 'utf8');

  // The default radio presentation must never turn an empty or legacy
  // `graduate` setting into an implicit CET-4 choice.
  assert.match(view, /const selected = normalizeSelectableTrack\(Config\.get\('exam_level'\)\);/);
  assert.doesNotMatch(view, /normalizeSelectableTrack\(Config\.get\('exam_level'\)\) \|\| 'cet4'/);
  assert.match(view, /function requireExplicitTargetTrack\(targetTrack\)/);
  assert.match(view, /请先选择目标考试导向后再继续/);
  assert.match(view, /if \(!requireExplicitTargetTrack\(targetTrack\)\) return;/);
  assert.match(view, /skip\(\) \{[\s\S]*?if \(!requireExplicitTargetTrack\(targetTrack\)\) return;/);
});

test('defensively preserves the target-selection gate before calibration completion writes configuration', async () => {
  const view = (await readFile(new URL('../src/views/calibration.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
  const finish = view.match(/\n  finish\(\) \{([\s\S]*?)\n  \},\n\n  skip\(\)/)?.[1] || '';

  assert.ok(finish, 'the calibration completion handler must remain identifiable');
  const targetGuard = finish.indexOf('const targetTrack = requireExplicitTargetTrack(this.state?.targetTrack);');
  const firstTargetWrite = finish.indexOf("Config.set('exam_level'");
  assert.ok(targetGuard >= 0 && targetGuard < firstTargetWrite,
    'completion must validate the explicit target before changing persisted configuration');
  assert.match(finish, /if \(!targetTrack\) return;/);
  assert.match(finish, /this\.state\.targetTrack = targetTrack;/);
});
