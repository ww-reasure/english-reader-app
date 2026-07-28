import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CALIBRATION_WORD_QUESTION_COUNT,
  applyReadingEaseFeedback,
  createCalibrationSession,
  getNextCalibrationQuestion,
  isQualifiedReading,
  recommendCalibrationMode,
  shouldRequestReadingEaseFeedback,
  submitCalibrationAnswer
} from '../src/calibration-engine.mjs';

const bank = Array.from({ length: 40 }, (_, index) => ({
  lemma: `word${index + 1}`,
  gloss: `释义${index + 1}`,
  frequencyTier: Math.floor(index / 10) + 1,
  quality: 'high'
}));

test('calibration uses exactly 24 adaptive word-meaning questions and treats unsure as evidence, not a correct answer', () => {
  let session = createCalibrationSession({ bank, targetTrack: 'cet6', seed: 7 });
  assert.equal(session.targetTrack, 'cet6');
  assert.equal(session.totalWordQuestions, CALIBRATION_WORD_QUESTION_COUNT);

  const first = getNextCalibrationQuestion(session);
  session = submitCalibrationAnswer(session, { lemma: first.lemma, outcome: 'correct' });
  const second = getNextCalibrationQuestion(session);
  assert.ok(second.frequencyTier >= first.frequencyTier);

  session = submitCalibrationAnswer(session, { lemma: second.lemma, outcome: 'unsure' });
  assert.equal(session.answers.at(-1).outcome, 'unsure');
  assert.equal(session.correctCount, 1);
  assert.equal(session.answers.at(-1).countsAsKnown, false);
});

test('preserves the audited NGSL band on each calibration answer for later personal matching', () => {
  const traceableBank = Array.from({ length: 24 }, (_, index) => ({
    lemma: `traceable${index}`,
    gloss: `释义${index}`,
    frequencyTier: 2,
    frequencyBand: 'ngsl-2',
    quality: 'high'
  }));
  let session = createCalibrationSession({ bank: traceableBank, seed: 3 });
  const question = getNextCalibrationQuestion(session);
  session = submitCalibrationAnswer(session, { lemma: question.lemma, outcome: 'correct' });

  assert.equal(session.answers[0].frequencyBand, 'ngsl-2');
});

test('uses a stratified warm-up so every available audited frequency band has direct calibration evidence before adapting', () => {
  // Six reviewed entries per tier match the production bank contract: the
  // first question is an anchor and enough alternatives remain for the
  // adaptive part of this 24-question diagnostic.
  const stratifiedBank = Array.from({ length: 36 }, (_, index) => {
    const tier = (index % 6) + 1;
    return {
      lemma: `stratified${index}`,
      gloss: `释义${index}`,
      frequencyTier: tier,
      frequencyBand: `ngsl-${tier}`,
      quality: 'high'
    };
  });
  let session = createCalibrationSession({ bank: stratifiedBank, seed: 19 });

  for (let index = 0; index < 6; index += 1) {
    const question = getNextCalibrationQuestion(session);
    session = submitCalibrationAnswer(session, { lemma: question.lemma, outcome: 'unsure' });
  }

  assert.deepEqual(
    session.answers.map(answer => answer.frequencyBand),
    ['ngsl-1', 'ngsl-2', 'ngsl-3', 'ngsl-4', 'ngsl-5', 'ngsl-6']
  );
});

test('a calibration recommendation changes the mode only and requires a minimum reading-comprehension check', () => {
  const recommendation = recommendCalibrationMode({
    targetTrack: 'kaoyan1',
    answers: Array.from({ length: 24 }, (_, index) => ({ outcome: index < 18 ? 'correct' : 'incorrect' })),
    readingComprehension: { correct: 1, total: 3 }
  });

  assert.equal(recommendation.targetTrack, 'kaoyan1');
  assert.equal(recommendation.challenge, 'support');
  assert.equal(recommendation.reason, 'reading_check');
  assert.equal(recommendation.vocabularySizeEstimate, undefined);
});

test('only an active, completed and sufficiently browsed reading becomes personal-profile evidence', () => {
  const requiredSeconds = Math.max(45, (400 / 400) * 60);
  assert.equal(requiredSeconds, 60);
  assert.equal(isQualifiedReading({ completed: true, scrollDepth: 0.7, activeSeconds: 60, wordCount: 400 }), true);
  assert.equal(isQualifiedReading({ completed: true, scrollDepth: 0.69, activeSeconds: 60, wordCount: 400 }), false);
  assert.equal(isQualifiedReading({ completed: true, scrollDepth: 0.8, activeSeconds: 59, wordCount: 400 }), false);
  assert.equal(isQualifiedReading({ completed: false, scrollDepth: 1, activeSeconds: 200, wordCount: 400 }), false);
});

test('skipped calibration asks for one ease judgement only after three qualified readings and keeps the chosen target', () => {
  const skipped = { calibration: { status: 'skipped' }, qualifiedReadingCount: 3, readingEaseFeedback: null, targetTrack: 'kaoyan2', recommendedChallenge: 'standard' };
  assert.equal(shouldRequestReadingEaseFeedback(skipped), true);

  const updated = applyReadingEaseFeedback(skipped, 'too_hard');
  assert.equal(updated.targetTrack, 'kaoyan2');
  assert.equal(updated.recommendedChallenge, 'support');
  assert.equal(updated.readingEaseFeedback.choice, 'too_hard');
  assert.equal(shouldRequestReadingEaseFeedback(updated), false);
});
