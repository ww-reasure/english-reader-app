function sourceQuestionNumber(question, fallback = '') {
  const match = String(question?.questionKey || '').match(/_q(\d+)$/i);
  if (match) return String(Number(match[1]));
  return String(question?.blankNumber || question?.slotNumber || String(question?.segmentKey || '').replace(/^S/i, '') || fallback);
}

function groupLabel(unit) {
  if (unit?.displayTitle) return unit.displayTitle;
  if (unit?.type === 'cloze_choice') return '完形填空';
  if (unit?.type === 'reading_mcq') return '阅读理解';
  if (['paragraph_ordering', 'matching'].includes(unit?.type)) return '阅读新题型 Part B';
  if (unit?.type === 'translation') return '翻译';
  return '真题训练';
}

function isAnswered(unit, response) {
  if (unit?.type === 'translation') return Boolean(response?.value?.text?.trim());
  return Boolean(response?.answer);
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

export function buildAnswerCardModel({ attempt = {}, units = [], responses = new Map(), currentQuestionKey = '' } = {}) {
  const order = Array.isArray(attempt.questionOrder) ? attempt.questionOrder : [];
  const allowed = new Set(order);
  const questionRank = new Map(order.map((questionKey, index) => [questionKey, index]));
  let visibleUnits = units;

  if (attempt.practiceKind === 'full_paper' && Array.isArray(attempt.unitOrder) && attempt.unitOrder.length) {
    const unitRank = new Map(attempt.unitOrder.map((unitKey, index) => [unitKey, index]));
    visibleUnits = [...units].sort((a, b) => (
      (unitRank.get(a.unitKey) ?? Number.MAX_SAFE_INTEGER)
      - (unitRank.get(b.unitKey) ?? Number.MAX_SAFE_INTEGER)
    ));
  }

  if (attempt.practiceKind !== 'full_paper') {
    const currentUnitKey = attempt.currentUnitKey || attempt.unitKey;
    const currentUnit = units.find(unit => unit.unitKey === currentUnitKey || unit.questions?.some(question => question.questionKey === currentQuestionKey));
    visibleUnits = currentUnit ? [currentUnit] : units.slice(0, 1);
  }

  const entries = [];
  const groups = visibleUnits.map(unit => {
    const unitIndex = units.findIndex(item => item.unitKey === unit.unitKey);
    const questions = (unit.questions || [])
      .filter(question => !allowed.size || allowed.has(question.questionKey))
      .sort((a, b) => (questionRank.get(a.questionKey) ?? Number.MAX_SAFE_INTEGER) - (questionRank.get(b.questionKey) ?? Number.MAX_SAFE_INTEGER))
      .map((question, questionIndex) => {
        const response = responses.get(question.questionKey);
        const globalIndex = questionRank.get(question.questionKey) ?? entries.length;
        const fullPaperFallback = attempt.practiceKind === 'full_paper' ? String(globalIndex + 1) : '';
        const explicitSourceNumber = String(question?.questionKey || '').match(/_q(\d+)$/i)?.[1];
        const entry = {
          questionKey: question.questionKey,
          label: explicitSourceNumber ? String(Number(explicitSourceNumber)) : fullPaperFallback || sourceQuestionNumber(question, String(entries.length + 1)),
          answered: isAnswered(unit, response),
          uncertain: Boolean(response?.uncertain),
          current: question.questionKey === currentQuestionKey,
          unitIndex,
          questionIndex,
          globalIndex
        };
        entries.push(entry);
        return entry;
      });
    return { unitKey: unit.unitKey, label: groupLabel(unit), questions };
  }).filter(group => group.questions.length);

  entries.sort((a, b) => a.globalIndex - b.globalIndex);
  const answered = entries.filter(question => question.answered).length;
  const currentIndex = entries.findIndex(question => question.current);
  return {
    total: entries.length,
    answered,
    unanswered: entries.length - answered,
    uncertain: entries.filter(question => question.uncertain).length,
    currentPosition: currentIndex >= 0 ? currentIndex + 1 : 1,
    groups
  };
}

export function renderAnswerCardHtml(model) {
  return `<section class="exam-answer-card" role="dialog" aria-modal="true" aria-labelledby="examAnswerCardTitle">
    <header class="exam-answer-card-head">
      <div><p class="page-eyebrow">ANSWER SHEET</p><h2 id="examAnswerCardTitle">答题卡</h2></div>
      <button id="examAnswerCardClose" class="app-icon-button" type="button" aria-label="关闭答题卡">×</button>
    </header>
    <div class="exam-answer-card-summary" aria-label="答题进度">
      <span><b>${model.answered}</b>已答</span><span><b>${model.unanswered}</b>未答</span><span><b>${model.uncertain}</b>不确定</span>
    </div>
    <div class="exam-answer-card-groups">
      ${model.groups.map(group => `<section class="exam-answer-card-group" data-answer-unit="${esc(group.unitKey)}">
        <h3>${esc(group.label)}</h3>
        <div class="exam-answer-card-grid">${group.questions.map(question => `<button type="button" class="exam-answer-card-question ${question.answered ? 'is-answered' : 'is-unanswered'} ${question.current ? 'is-current' : ''} ${question.uncertain ? 'is-uncertain' : ''}" data-answer-question="${esc(question.questionKey)}" aria-current="${question.current ? 'true' : 'false'}" aria-label="第 ${esc(question.label)} 题，${question.answered ? '已答' : '未答'}${question.uncertain ? '，已标记不确定' : ''}">${esc(question.label)}${question.uncertain ? '<i aria-hidden="true"></i>' : ''}</button>`).join('')}</div>
      </section>`).join('')}
    </div>
    <footer class="exam-answer-card-footer">
      <p>共 ${model.total} 题，未答 ${model.unanswered} 题</p>
      <button id="examAnswerCardSubmit" class="btn btn-primary" type="button">交卷</button>
    </footer>
  </section>`;
}
