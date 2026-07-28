const EXAM_BADGE_LABELS = {
  cet4: '四级',
  cet6: '六级',
  kaoyan1: '英一',
  kaoyan2: '英二',
  graduate: '考研'
};

const FREQUENCY_BADGE_LABELS = {
  high: '高频',
  medium: '中频',
  low: '低频'
};

export function renderTooltipWordBadges(data = {}, escape = value => String(value)) {
  const examBadges = [...new Set(Array.isArray(data.examLevels) ? data.examLevels : [])]
    .filter(level => EXAM_BADGE_LABELS[level])
    .map(level => `<span class="tooltip-word-badge tooltip-word-badge--exam exam-${escape(level)}">${escape(EXAM_BADGE_LABELS[level])}</span>`);
  const frequency = String(data.freqLevel || '').trim();
  const frequencyBadge = FREQUENCY_BADGE_LABELS[frequency]
    ? [`<span class="tooltip-word-badge tooltip-word-badge--freq freq-${escape(frequency)}">${escape(FREQUENCY_BADGE_LABELS[frequency])}</span>`]
    : [];
  return [...examBadges, ...frequencyBadge].join('');
}
