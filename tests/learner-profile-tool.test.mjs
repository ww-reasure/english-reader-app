import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadAgent() {
  const [source, analytics, learningDay] = await Promise.all([
    readFile(new URL('../src/components/learning-agent.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/reading-analytics.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/learning-day.mjs', import.meta.url), 'utf8')
  ]);
  const metadataUrl = new URL('../src/cloud-article-metadata.mjs', import.meta.url).href;
  const adapted = source.replace(
    "import { buildReadingAnalytics } from '../reading-analytics.mjs';",
    analytics
      .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
      .replace(/^export /gm, '')
  ).replace(
    "import { localDayKey } from '../learning-day.mjs';",
    learningDay.replace(/^export /gm, '')
  );
  return import('data:text/javascript;base64,' + Buffer.from(adapted).toString('base64'));
}

async function loadProfileModule() {
  return import('../src/learner-profile.mjs');
}

const settings = {
  targetTrack: 'kaoyan1',
  readingMode: 'stretch',
  calibrationStatus: 'new',
  coverage: '94',
  newWordPercent: '6',
  assessmentDate: '',
  assessmentProfile: ''
};

test('declares get_learner_profile as a no-argument read-only tool', async () => {
  const { LEARNING_TOOLS } = await loadAgent();
  const definition = LEARNING_TOOLS.find(tool => tool.function.name === 'get_learner_profile');
  assert.ok(definition);
  assert.deepEqual(definition.function.parameters, {
    type: 'object',
    properties: {},
    additionalProperties: false
  });
  assert.match(definition.function.description, /只读/);
});

test('executes the learner profile tool without passing model arguments to the provider', async () => {
  const { LearningAgent } = await loadAgent();
  const profile = {
    source: 'learner_profile',
    learnerSettings: { targetExam: { id: 'cet4' } },
    abilityEvidence: { status: 'insufficient' }
  };
  const calls = [];
  const agent = new LearningAgent({
    db: {},
    srs: {},
    learnerProfileProvider: {
      getProfile: async (...args) => {
        calls.push(args);
        return profile;
      }
    }
  });

  assert.deepEqual(await agent.execute('get_learner_profile', { date: '1900-01-01' }), profile);
  assert.deepEqual(calls, [[]]);
});

test('builds settings from configuration without turning material targets into measured ability', async () => {
  const { buildLearnerProfile } = await loadProfileModule();
  const result = buildLearnerProfile({ settings });

  assert.deepEqual(result.learnerSettings.targetExam, { id: 'kaoyan1', label: '考研英语一' });
  assert.equal(result.learnerSettings.readingPressure.configuredMode, 'stretch');
  assert.equal(result.learnerSettings.configuredTargets.targetCoveragePercent, 94);
  assert.equal(result.learnerSettings.configuredTargets.newWordPercent, 6);
  assert.equal(result.abilityEvidence.status, 'insufficient');
  assert.equal(result.abilityEvidence.hasSufficientValidEvidence, false);
  assert.equal(result.abilityEvidence.frequencyBands.length, 0);
  assert.equal(result.abilityEvidence.measuredCoveragePercent, undefined);
});

test('the composition provider reads current Config values and the knowledge-profile summary', async () => {
  const { createLearnerProfileProvider } = await loadProfileModule();
  const values = {
    exam_level: 'cet6',
    reading_mode: 'support',
    calibration_status: 'skipped',
    coverage: '98',
    new_word_percent: '2',
    assessment_date: '2026-08-28',
    assessment_profile: ''
  };
  let summaryCalls = 0;
  const provider = createLearnerProfileProvider({
    config: { get: key => values[key] },
    knowledgeProfile: {
      getSummary: async () => {
        summaryCalls += 1;
        return {
          status: 'available',
          bands: [{
            band: 'ngsl-1',
            successCount: 4,
            failureCount: 1,
            independentSuccessCount: 2,
            independentFailureCount: 1,
            masteryProbability: 0.714,
            confidence: 0.455
          }]
        };
      }
    }
  });

  const result = await provider.getProfile();
  assert.equal(summaryCalls, 1);
  assert.equal(result.learnerSettings.targetExam.id, 'cet6');
  assert.equal(result.learnerSettings.readingPressure.configuredMode, 'support');
  assert.equal(result.learnerSettings.configuredTargets.targetCoveragePercent, 98);
  assert.equal(result.learnerSettings.configuredTargets.newWordPercent, 2);
  assert.equal(result.abilityEvidence.status, 'provisional');
});

test('the knowledge-profile adapter exposes aggregate bands and feedback but never raw evidence', async () => {
  const { createKnowledgeProfileRepository } = await import('../src/knowledge-profile.mjs');
  const storage = {
    getKnowledgeWord: async () => null,
    getKnowledgeBand: async () => null,
    getKnowledgeProfileMeta: async key => key === 'knowledge-profile-reading-feedback'
      ? { value: 'fitting', qualifiedArticleIds: ['a', 'b'], submittedAt: 456 }
      : { articleIds: ['a', 'b', 'c'] },
    getKnowledgeEvidenceByCalibrationKey: async () => null,
    getAllKnowledgeBands: async () => [{
      band: 'ngsl-1',
      successCount: 3,
      failureCount: 1,
      independentSuccessCount: 2,
      independentFailureCount: 1
    }],
    saveKnowledgeProfileMeta: async () => null,
    saveKnowledgeProfileUpdate: async () => null
  };

  const summary = await createKnowledgeProfileRepository(storage).getSummary();
  assert.equal(summary.status, 'available');
  assert.equal(summary.bands[0].band, 'ngsl-1');
  assert.equal(summary.difficultyFeedback.value, 'fitting');
  assert.equal(summary.difficultyFeedback.qualifiedReadingCount, 3);
  assert.equal('evidence' in summary, false);
});

test('summarizes insufficient, provisional, and established evidence from bounded frequency bands', async () => {
  const { buildLearnerProfile } = await loadProfileModule();

  const insufficient = buildLearnerProfile({ settings, knowledge: { status: 'available', bands: [] } });
  assert.equal(insufficient.abilityEvidence.status, 'insufficient');

  const provisional = buildLearnerProfile({
    settings: { ...settings, calibrationStatus: 'calibrated' },
    knowledge: {
      status: 'available',
      bands: [{
        band: 'ngsl-1',
        successCount: 2,
        failureCount: 1,
        independentSuccessCount: 1,
        independentFailureCount: 0,
        masteryProbability: 0.6,
        confidence: 0.333
      }],
      difficultyFeedback: { value: 'too_hard', qualifiedReadingCount: 3, submittedAt: 123 }
    }
  });
  assert.equal(provisional.abilityEvidence.status, 'provisional');
  assert.equal(provisional.abilityEvidence.frequencyBands[0].band, 'ngsl-1');
  assert.equal(provisional.abilityEvidence.frequencyBands[0].masteryProbability, 0.6);
  assert.equal(provisional.abilityEvidence.recentDifficultyFeedback.value, 'too_hard');

  const established = buildLearnerProfile({
    settings: { ...settings, calibrationStatus: 'calibrated' },
    knowledge: {
      status: 'available',
      bands: [
        { band: 'ngsl-1', successCount: 8, failureCount: 2, independentSuccessCount: 4, independentFailureCount: 1, masteryProbability: 0.75, confidence: 0.625 },
        { band: 'ngsl-2', successCount: 5, failureCount: 1, independentSuccessCount: 3, independentFailureCount: 1, masteryProbability: 0.667, confidence: 0.5 }
      ]
    }
  });
  assert.equal(established.abilityEvidence.status, 'established');
  assert.equal(established.abilityEvidence.hasSufficientValidEvidence, true);
  assert.equal(established.abilityEvidence.frequencyBands.length, 2);
});

test('ignores saved-word counts and caps the profile without exposing raw evidence', async () => {
  const { buildLearnerProfile } = await loadProfileModule();
  const result = buildLearnerProfile({
    settings,
    knowledge: {
      status: 'available',
      savedWordCount: 9999,
      evidence: Array.from({ length: 999 }, (_, index) => ({ lemma: `secret-${index}` })),
      bands: Array.from({ length: 40 }, (_, index) => ({
        band: `band-${index}`,
        successCount: 1,
        failureCount: 0,
        independentSuccessCount: 1,
        independentFailureCount: 0,
        masteryProbability: 0.667,
        confidence: 0.143
      }))
    }
  });
  assert.ok(result.abilityEvidence.frequencyBands.length <= 12);
  assert.equal('evidence' in result.abilityEvidence, false);
  assert.equal('savedWordCount' in result.abilityEvidence, false);
  assert.ok(JSON.stringify(result).length < 8000);
});

test('the home harness includes the profile tool and prompt guidance without a hard-coded router', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  const context = await readFile(new URL('../src/components/context-builder.js', import.meta.url), 'utf8');
  assert.match(source, /HOME_LEARNING_TOOLS\s*=\s*\[\.\.\.LEARNING_TOOLS/);
  assert.match(source, /learnerProfileProvider/);
  assert.match(context, /get_learner_profile/);
  assert.match(context, /tool_choice=auto|tool_choice auto|自动调用/s);
  assert.doesNotMatch(context, /硬编码.*get_learner_profile/);
});
