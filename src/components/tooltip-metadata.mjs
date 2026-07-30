import { selectExamCorpusPresentation } from './exam-corpus-presentation.mjs';

const MEMBERSHIP_LABELS = Object.freeze({
  cet4: '四级词表',
  cet6: '六级词表',
  kaoyan1: '考研词表',
  kaoyan2: '考研词表',
  'kaoyan-general': '考研词表',
  graduate: '考研词表'
});

const FREQUENCY_BADGE_LABELS = {
  high: '通用高频',
  medium: '通用中频',
  low: '通用低频'
};

function membershipMatches(levels, targetTrack) {
  const values = new Set(Array.isArray(levels) ? levels : []);
  if (['kaoyan1', 'kaoyan2', 'kaoyan-general', 'graduate'].includes(targetTrack)) {
    return ['kaoyan-general', 'graduate', 'kaoyan1', 'kaoyan2'].some(level => values.has(level));
  }
  return values.has(targetTrack);
}

export function renderTooltipWordBadges(data = {}, escape = value => String(value), targetTrack = '') {
  const presentation = selectExamCorpusPresentation(data.examCorpus, targetTrack);
  const examBadge = presentation
    ? [`<span class="tooltip-word-badge ${presentation.observed ? 'tooltip-word-badge--exam-priority' : 'tooltip-word-badge--exam'} exam-${escape(presentation.corpusTrack)}">${escape(presentation.badgeLabel)}</span>`]
    : membershipMatches(data.examLevels, targetTrack) && MEMBERSHIP_LABELS[targetTrack]
      ? [`<span class="tooltip-word-badge tooltip-word-badge--exam exam-${escape(targetTrack)}">${escape(MEMBERSHIP_LABELS[targetTrack])}</span>`]
      : [];
  const frequency = String(data.freqLevel || '').trim();
  const frequencyBadge = FREQUENCY_BADGE_LABELS[frequency]
    ? [`<span class="tooltip-word-badge tooltip-word-badge--freq freq-${escape(frequency)}">${escape(FREQUENCY_BADGE_LABELS[frequency])}</span>`]
    : [];
  return [...examBadge, ...frequencyBadge].join('');
}
