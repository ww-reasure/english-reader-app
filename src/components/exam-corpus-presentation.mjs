import { corpusTrackForTarget } from '../exam-corpus.mjs';

const TRACK_PRESENTATION = Object.freeze({
  cet4: { trackLabel: '四级', membershipLabel: '四级词表' },
  cet6: { trackLabel: '六级', membershipLabel: '六级词表' },
  'kaoyan-general': { trackLabel: '考研通用', membershipLabel: '考研词表' }
});

const text = value => String(value || '').trim();
const count = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;

export function selectExamCorpusPresentation(examCorpus = {}, targetTrack = '') {
  const corpusTrack = corpusTrackForTarget(targetTrack);
  const config = TRACK_PRESENTATION[corpusTrack];
  const record = examCorpus && typeof examCorpus === 'object' ? examCorpus[corpusTrack] : null;
  if (!config || !record || typeof record !== 'object') return null;

  const observed = record.priorityTier !== 'uncovered'
    && (count(record?.counts?.sentenceTotal) > 0 || ['core', 'frequent', 'appeared'].includes(record.priorityTier));
  return {
    corpusTrack,
    targetTrack: text(targetTrack),
    trackLabel: config.trackLabel,
    membershipLabel: config.membershipLabel,
    badgeLabel: observed
      ? `${config.trackLabel} · ${text(record.priorityLabel) || '真题出现'}`
      : config.membershipLabel,
    isGraduateShared: corpusTrack === 'kaoyan-general',
    observed,
    record
  };
}

export function renderExamCorpusDetail(presentation, escape = value => String(value)) {
  if (!presentation?.record) return '';
  const { record } = presentation;
  const counts = record.counts || {};
  const statusMarkup = presentation.observed
    ? `<div class="word-study-exam-metrics">
        <span>正文 ${escape(count(counts.passage))} 次</span>
        <span>题干 ${escape(count(counts.questionStem))} 次</span>
        <span>覆盖 ${escape(count(counts.papers))} 套</span>
        <span>${escape(count(counts.years))} 个年份</span>
      </div>`
    : '<p class="word-study-exam-note">属于考试方向词表；当前收录真题语料未见，仅表示本次收录范围内未检索到记录。</p>';
  const graduateNote = presentation.isGraduateShared
    ? '<p class="word-study-exam-note">频度采用英语一、英语二合并口径；例句仍按真实试卷分别筛选。</p>'
    : '';
  return `<section class="word-study-exam-corpus" aria-label="考试频度">
    <div class="word-study-exam-heading">
      <span>考试频度</span>
      <strong>${escape(presentation.badgeLabel)}</strong>
    </div>
    ${statusMarkup}
    ${graduateNote}
  </section>`;
}
