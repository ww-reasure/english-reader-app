/**
 * Offline first-run calibration. It is intentionally separate from the legacy
 * two-article assessment so a recommendation can never overwrite the user's
 * chosen exam target.
 */
import { Config } from '../config.js';
import { DB } from '../db.js';
import { esc } from '../helpers.js';
import { listSelectableTracks, normalizeSelectableTrack, requiresTargetTrackSelection } from '../learning-track.mjs';
import { normalizeCoveragePreference } from '../difficulty-profile.mjs';
import {
  CALIBRATION_WORD_QUESTION_COUNT,
  createCalibrationSession,
  getNextCalibrationQuestion,
  recommendCalibrationMode,
  submitCalibrationAnswer
} from '../calibration-engine.mjs';
import { createKnowledgeProfileRepository } from '../knowledge-profile.mjs';
import { createLexiconLoader } from '../lexicon-runtime.mjs';
import { CALIBRATION_SHORT_READING } from '../calibration-content.mjs';

const lexiconLoader = createLexiconLoader();

const SHORT_READING = CALIBRATION_SHORT_READING;

const modeLabel = mode => ({ support: '巩固', standard: '对标', stretch: '加压' }[mode] || '对标');

function requireExplicitTargetTrack(targetTrack) {
  const normalized = normalizeSelectableTrack(targetTrack);
  if (normalized) return normalized;
  alert('请先选择目标考试导向后再继续。');
  return null;
}

function entryGloss(entry) {
  const sense = (entry?.senses || []).find(item => typeof item?.glossZh === 'string' && item.glossZh.trim());
  return sense?.glossZh?.trim() || '';
}

function frequencyTier(entry) {
  const values = Array.isArray(entry?.layers?.frequency) ? entry.layers.frequency : [entry?.layers?.frequency].filter(Boolean);
  const label = String(values[0]?.band || values[0]?.tier || values[0]?.level || '').toLowerCase();
  const number = Number.parseInt(label.match(/\d+/)?.[0], 10);
  if (Number.isFinite(number)) return Math.max(1, Math.min(6, number));
  return label.includes('ngsl') || label.includes('high') ? 1 : 3;
}

function frequencyBand(entry) {
  const values = Array.isArray(entry?.layers?.frequency) ? entry.layers.frequency : [entry?.layers?.frequency].filter(Boolean);
  const sourceRefs = new Set(Array.isArray(entry?.sourceRefs) ? entry.sourceRefs : []);
  const layer = values.find(value => {
    const band = String(value?.band || '').trim();
    const sourceRef = String(value?.sourceRef || '').trim();
    return band && sourceRef && sourceRefs.has(sourceRef);
  });
  return String(layer?.band || '').trim().toLowerCase();
}

function toCalibrationBank(core) {
  return (core?.entries || [])
    .filter(entry => entry?.quality === 'high' && frequencyBand(entry))
    .map(entry => ({
      lemma: String(entry.lemma || '').trim().toLowerCase(),
      gloss: entryGloss(entry),
      frequencyTier: frequencyTier(entry),
      frequencyBand: frequencyBand(entry),
      quality: entry.quality,
      sourceRefs: entry.sourceRefs || []
    }))
    .filter(entry => entry.lemma && entry.gloss);
}

function deterministicChoices(question, bank, questionIndex) {
  const distractors = bank
    .filter(entry => entry.lemma !== question.lemma && entry.gloss !== question.gloss)
    .sort((left, right) => left.lemma.localeCompare(right.lemma));
  const selected = [];
  for (let offset = 0; selected.length < 3 && offset < distractors.length; offset += 1) {
    const candidate = distractors[(questionIndex * 7 + offset * 11) % distractors.length];
    if (candidate && !selected.some(item => item.gloss === candidate.gloss)) selected.push(candidate);
  }
  const choices = [{ gloss: question.gloss, outcome: 'correct' }, ...selected.map(entry => ({ gloss: entry.gloss, outcome: 'incorrect' }))];
  return choices.sort((left, right) => (left.gloss.length + questionIndex * 3) % 7 - (right.gloss.length + questionIndex * 3) % 7 || left.gloss.localeCompare(right.gloss));
}

export const CalibrationView = {
  container: null,
  state: null,

  cleanup() {
    this.container = null;
    this.state = null;
  },

  render(container) {
    this.container = container;
    const selected = normalizeSelectableTrack(Config.get('exam_level'));
    const targetTrack = requiresTargetTrackSelection(
      Config.get('exam_level'),
      Config.get('target_track_selection_required')
    ) ? null : selected;
    this.state = { step: 'intro', targetTrack, session: null, bank: [], readingAnswers: [] };
    this.renderIntro();
  },

  renderIntro() {
    const targetOptions = listSelectableTracks().map(track => `
      <label class="settings-radio">
        <input type="radio" name="calibrationTargetTrack" value="${track.id}" ${this.state.targetTrack === track.id ? 'checked' : ''}>
        <span class="settings-radio-label"><span class="settings-radio-title">${track.label}</span><span class="settings-radio-desc">${track.description}</span></span>
      </label>`).join('');
    this.container.innerHTML = `
      <section class="app-standard-page assessment-container calibration-container" aria-labelledby="calibrationTitle">
        <header class="assessment-header">
          <p class="page-eyebrow">05 / BASELINE</p>
          <h1 id="calibrationTitle" class="page-title app-route-heading">3 分钟阅读校准</h1>
          <p class="assessment-desc">24 道分层自适应词义题，加一篇短阅读理解。前几题覆盖不同词频层，随后会根据作答调整；它只推荐材料的相对压力，不会改写你的目标考试，也不会给出“词汇量”数字。</p>
        </header>
        <div class="assessment-section">
          <h2 class="settings-section-title">选择目标考试导向</h2>
          <div class="settings-options">${targetOptions}</div>
        </div>
        <div class="assessment-info-box">
          <h3>校准如何使用</h3>
          <ol><li>词义题答对是“暂定掌握”证据；不认识和不确定都可以选择。</li><li>短阅读验证最低理解，不用 API，也不上传你的学习数据。</li><li>结果只推荐巩固、对标或加压；之后可在设置中手动微调覆盖率。</li></ol>
        </div>
        <div class="assessment-actions">
          <button class="btn btn-primary btn-lg" onclick="CalibrationView.start()">开始 24 题校准</button>
          <button class="btn btn-outline" onclick="CalibrationView.skip()">跳过，先保守阅读</button>
        </div>
      </section>`;
  },

  async start() {
    const targetTrack = document.querySelector('input[name="calibrationTargetTrack"]:checked')?.value || this.state?.targetTrack;
    if (!requireExplicitTargetTrack(targetTrack)) return;
    this.state.targetTrack = targetTrack;
    this.container.innerHTML = '<section class="app-standard-page assessment-container"><div class="assessment-loading"><div class="loading-spinner"></div><p>正在加载离线校准词库…</p></div></section>';
    try {
      const core = await lexiconLoader.loadCore();
      const bank = toCalibrationBank(core);
      this.state.bank = bank;
      this.state.session = createCalibrationSession({ bank, targetTrack, seed: Date.now() });
      if (this.state.session.stratification.status === 'partial') {
        this.state.calibrationBankNotice = '部分词频层审核条目不足；本次仅在审核充分的层中分层，不会把本次结果表述为完整分层校准。';
      } else {
        this.state.calibrationBankNotice = '';
      }
      // A re-calibration is a new diagnostic attempt, while every click in
      // this attempt still has a stable immutable question key. This avoids
      // both accidental double-counting and permanently blocking a genuine
      // later calibration session.
      this.state.calibrationAttemptId = `calibration-v2:${targetTrack}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
      this.state.step = 'words';
      this.renderWordQuestion();
    } catch (error) {
      this.container.innerHTML = `
        <section class="app-standard-page assessment-container">
          <div class="empty-state">
            <p>离线校准词库暂不可用。</p>
            <p class="text-muted">${esc(error?.message || '请检查应用资源是否完整。')}</p>
            <p class="text-muted">你可以先进入保守阅读；待词库资源恢复后，再从设置重新校准。</p>
            <div class="assessment-actions">
              <button class="btn btn-primary" onclick="CalibrationView.renderIntro()">返回重试</button>
              <button class="btn btn-outline" onclick="CalibrationView.skip()">跳过，先保守阅读</button>
            </div>
          </div>
        </section>`;
    }
  },

  renderWordQuestion() {
    const question = getNextCalibrationQuestion(this.state.session);
    if (!question) return this.renderReadingCheck();
    const index = this.state.session.answers.length;
    const choices = deterministicChoices(question, this.state.bank, index);
    this.state.currentQuestion = question;
    const calibrationBankNotice = this.state.calibrationBankNotice
      ? `<p class="text-muted calibration-bank-notice">${esc(this.state.calibrationBankNotice)}</p>`
      : '';
    this.container.innerHTML = `
      <section class="app-standard-page assessment-container calibration-container" aria-labelledby="wordQuestionTitle">
        <header class="assessment-header"><p class="page-eyebrow">词义校准 ${index + 1} / ${CALIBRATION_WORD_QUESTION_COUNT}</p><div class="assessment-progress"><span style="width:${Math.round(((index + 1) / CALIBRATION_WORD_QUESTION_COUNT) * 100)}%"></span></div></header>
        <div class="calibration-word-card">
          ${calibrationBankNotice}
          <p class="text-muted">请选择最接近的常用学习义</p>
          <h1 id="wordQuestionTitle">${esc(question.lemma)}</h1>
          <div class="calibration-word-options">
            ${choices.map(choice => `<button class="btn btn-outline" onclick="CalibrationView.submitWordAnswer('${choice.outcome}')">${esc(choice.gloss)}</button>`).join('')}
          </div>
          <button class="btn btn-text calibration-unsure" onclick="CalibrationView.submitWordAnswer('unsure')">不认识 / 不确定</button>
        </div>
      </section>`;
  },

  async submitWordAnswer(outcome) {
    const question = this.state.currentQuestion;
    if (!question) return;
    try {
      const index = this.state.session.answers.length;
      this.state.session = submitCalibrationAnswer(this.state.session, { lemma: question.lemma, outcome });
      const profile = createKnowledgeProfileRepository(DB);
      await profile.recordCalibrationEvidence({
        questionId: `${this.state.calibrationAttemptId}:${index}:${question.lemma}`,
        word: question.lemma,
        band: question.frequencyBand,
        correct: outcome === 'correct',
        sawAnswer: false,
        source: 'initial-calibration',
        attemptId: this.state.calibrationAttemptId
      });
      this.renderWordQuestion();
    } catch (error) {
      alert(error?.message || '记录本题时出现问题，请重试。');
    }
  },

  renderReadingCheck() {
    this.state.step = 'reading';
    this.container.innerHTML = `
      <section class="app-standard-page assessment-container calibration-container" aria-labelledby="readingCheckTitle">
        <header class="assessment-header"><p class="page-eyebrow">短阅读验证</p><h1 id="readingCheckTitle" class="page-title">${SHORT_READING.title}</h1><p class="assessment-desc">完成下列 3 道题，验证最低理解。可返回设置后重新校准。</p></header>
        <article class="assessment-reading-text">${esc(SHORT_READING.content)}</article>
        <form id="calibrationReadingForm" class="assessment-quiz">
          ${SHORT_READING.questions.map((item, index) => `<fieldset><legend>${index + 1}. ${esc(item.question)}</legend>${item.options.map((option, optionIndex) => `<label><input type="radio" name="readingCheck${index}" value="${optionIndex}"> ${esc(option)}</label>`).join('')}</fieldset>`).join('')}
        </form>
        <div class="assessment-actions"><button class="btn btn-primary" onclick="CalibrationView.finish()">查看匹配建议</button></div>
      </section>`;
  },

  finish() {
    const targetTrack = requireExplicitTargetTrack(this.state?.targetTrack);
    if (!targetTrack) return;
    this.state.targetTrack = targetTrack;
    const answers = SHORT_READING.questions.map((_, index) => Number.parseInt(document.querySelector(`input[name="readingCheck${index}"]:checked`)?.value, 10));
    if (answers.some(answer => !Number.isInteger(answer))) {
      alert('请完成全部阅读理解题后查看结果。');
      return;
    }
    const correct = answers.reduce((total, answer, index) => total + (answer === SHORT_READING.questions[index].answer ? 1 : 0), 0);
    const recommendation = recommendCalibrationMode({
      targetTrack: this.state.targetTrack,
      answers: this.state.session.answers,
      readingComprehension: { correct, total: SHORT_READING.questions.length }
    });
    const preference = normalizeCoveragePreference(recommendation.challenge);
    Config.set('exam_level', this.state.targetTrack);
    Config.set('target_track_selection_required', 'false');
    Config.set('reading_mode', recommendation.challenge);
    Config.set('level', recommendation.challenge === 'support' ? 'easy' : recommendation.challenge === 'stretch' ? 'hard' : 'normal');
    Config.set('coverage', String(preference.coverage));
    Config.set('new_word_percent', String(100 - preference.coverage));
    Config.set('calibration_status', 'calibrated');
    Config.set('assessment_done', 'true');
    Config.set('assessment_date', String(Date.now()));
    Config.set('assessment_profile', JSON.stringify({
      schemaVersion: 2,
      source: 'offline-adaptive-calibration',
      targetTrack: this.state.targetTrack,
      recommendedChallenge: recommendation.challenge,
      wordAccuracy: recommendation.wordAccuracy,
      readingComprehension: recommendation.readingComprehension
    }));
    this.renderResult(recommendation, preference);
  },

  skip() {
    const targetTrack = document.querySelector('input[name="calibrationTargetTrack"]:checked')?.value || this.state?.targetTrack;
    if (!requireExplicitTargetTrack(targetTrack)) return;
    const preference = normalizeCoveragePreference('support');
    Config.set('exam_level', targetTrack);
    Config.set('target_track_selection_required', 'false');
    Config.set('reading_mode', 'support');
    Config.set('level', 'easy');
    Config.set('coverage', String(preference.coverage));
    Config.set('new_word_percent', String(100 - preference.coverage));
    Config.set('calibration_status', 'skipped');
    Config.set('assessment_done', 'false');
    location.hash = '#/chat';
  },

  renderResult(recommendation, preference) {
    this.container.innerHTML = `
      <section class="app-standard-page assessment-container calibration-container" aria-labelledby="calibrationResultTitle">
        <header class="assessment-header"><p class="page-eyebrow">CALIBRATION COMPLETE</p><h1 id="calibrationResultTitle" class="page-title">推荐：${modeLabel(recommendation.challenge)}</h1></header>
        <div class="assessment-result-card">
          <p><strong>目标考试：</strong>${esc(listSelectableTracks().find(track => track.id === recommendation.targetTrack)?.label || recommendation.targetTrack)}</p>
          <p><strong>材料目标覆盖：</strong>${preference.range.min}–${preference.range.max}%（当前 ${preference.coverage}%）</p>
          <p><strong>词义题正确率：</strong>${recommendation.wordAccuracy}%</p>
          <p><strong>短阅读理解：</strong>${recommendation.readingComprehension.correct}/${recommendation.readingComprehension.total}</p>
          <p class="text-muted">初测只给出材料匹配建议；证据收集中，暂不承诺你的实际覆盖率或词汇量。之后系统会继续根据有效阅读、查词和独立回忆证据调整推荐。</p>
        </div>
        <div class="assessment-actions"><a href="#/chat" class="btn btn-primary">开始阅读</a></div>
      </section>`;
  }
};

window.CalibrationView = CalibrationView;
