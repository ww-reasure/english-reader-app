import { normalizeGuidedLearningSession } from './home-guided-learning.mjs';

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const text = value => esc(String(value || '').trim()).replace(/\n/g, '<br>');

export function renderLearningModeChoiceCard(message = {}) {
  const status = ['pending', 'resolved', 'skipped'].includes(message.status) ? message.status : 'pending';
  const disabled = status === 'pending' ? '' : ' disabled';
  const note = status === 'resolved'
    ? `已选择${message.selectedMode === 'guided' ? '互动教学' : '详细解析'}`
    : status === 'skipped' ? '已跳过这次选择' : '这次想怎么学？';
  return `<section class="learning-mode-choice-card is-${status}" data-learning-choice-id="${esc(message.id)}" data-source-message-id="${esc(message.sourceMessageId)}" aria-label="选择学习方式">
    <p>${esc(note)}</p>
    <div class="learning-mode-choice-actions">
      <button type="button" data-learning-mode="detailed"${disabled}><i class="fa-solid fa-list-check" aria-hidden="true"></i><span><strong>详细解析</strong><small>一次查看完整信息</small></span></button>
      <button type="button" data-learning-mode="guided"${disabled}><i class="fa-solid fa-route" aria-hidden="true"></i><span><strong>互动教学</strong><small>一步一步理解并练习</small></span></button>
    </div>
  </section>`;
}

const answerFeedback = (step, answer) => {
  if (!answer) return '';
  if (step.kind === 'choice') {
    return `<p class="guided-learning-feedback is-${answer.correct ? 'correct' : 'retry'}">${answer.correct ? '回答正确，可以继续。' : '还差一点，可以查看提示后再选。'}</p>`;
  }
  if (!answer.feedback) return '';
  return `<p class="guided-learning-feedback is-${answer.correct ? 'correct' : 'retry'}">${text(answer.feedback)}</p>`;
};

const stepInteraction = (step, session) => {
  const answer = session.answers[step.id];
  if (step.kind === 'choice') {
    return `<div class="guided-learning-question"><p>${text(step.prompt)}</p><div class="guided-learning-options">
      ${step.choices.map(choice => `<button type="button" class="${answer?.value === choice.id ? (answer.correct ? 'is-correct' : 'is-selected') : ''}" data-guided-action="choose" data-guided-choice="${esc(choice.id)}">${text(choice.text)}</button>`).join('')}
    </div>${answerFeedback(step, answer)}</div>`;
  }
  if (step.kind === 'free_response') {
    return `<div class="guided-learning-question"><p>${text(step.prompt)}</p>${answerFeedback(step, answer)}
      <button type="button" class="btn btn-primary btn-sm" data-guided-action="answer"><i class="fa-solid fa-pen" aria-hidden="true"></i>${answer ? '重新回答' : '在输入框回答'}</button>
    </div>`;
  }
  return '';
};

export function renderGuidedLearningCard(value) {
  const session = normalizeGuidedLearningSession(value);
  if (!session) return renderGuidedLearningFailureCard({ message: '教学卡内容不完整。' });
  const step = session.steps[session.currentStepIndex];
  const answer = session.answers[step.id];
  const canAdvance = step.kind === 'explain' || (step.kind === 'choice' && answer?.correct) || (step.kind === 'free_response' && answer?.correct);
  const progress = Math.round(((session.currentStepIndex + 1) / session.steps.length) * 100);
  if (session.status === 'completed') {
    return `<section class="guided-learning-card is-completed" data-guided-session-id="${esc(session.id)}" data-guided-revision="${session.revision}" aria-label="互动教学已完成">
      <header><span class="guided-learning-kicker">INTERACTIVE LESSON</span><strong>${text(session.target.title)}</strong></header>
      <div class="guided-learning-complete"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><h3>这一小节完成了</h3><p>${text(session.closingSummary)}</p></div>
      <div class="guided-learning-actions"><button type="button" data-guided-action="restart">重新浏览</button><button type="button" data-guided-action="detailed">查看详细解析</button></div>
    </section>`;
  }
  if (session.status === 'paused') {
    return `<section class="guided-learning-card is-paused" data-guided-session-id="${esc(session.id)}" data-guided-revision="${session.revision}" aria-label="互动教学已暂停">
      <header><span class="guided-learning-kicker">INTERACTIVE LESSON</span><strong>${text(session.target.title)}</strong></header>
      <p class="guided-learning-paused-copy">已停在第 ${session.currentStepIndex + 1} 步，进度会保留。</p>
      <div class="guided-learning-actions"><button type="button" data-guided-action="resume">继续学习</button><button type="button" data-guided-action="detailed">查看详细解析</button></div>
    </section>`;
  }
  return `<section class="guided-learning-card" data-guided-session-id="${esc(session.id)}" data-guided-revision="${session.revision}" data-guided-step-id="${esc(step.id)}" aria-label="互动教学：${esc(session.target.title)}">
    <header><div><span class="guided-learning-kicker">INTERACTIVE LESSON</span><strong>${text(session.target.title)}</strong></div><span class="guided-learning-count">${session.currentStepIndex + 1} / ${session.steps.length}</span></header>
    <div class="guided-learning-progress" aria-hidden="true"><span style="width:${progress}%"></span></div>
    <blockquote>${text(session.target.text)}</blockquote>
    <article class="guided-learning-step"><span class="guided-learning-step-label">STEP ${session.currentStepIndex + 1}</span><h3>${text(step.title)}</h3><p>${text(step.content)}</p>
      ${stepInteraction(step, session)}
      ${session.hints[step.id] && step.hint ? `<aside class="guided-learning-hint"><i class="fa-regular fa-lightbulb" aria-hidden="true"></i>${text(step.hint)}</aside>` : ''}
    </article>
    <footer>
      <div class="guided-learning-nav"><button type="button" data-guided-action="previous" ${session.currentStepIndex === 0 ? 'disabled' : ''} aria-label="上一步"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>
      ${step.hint ? `<button type="button" data-guided-action="hint">${session.hints[step.id] ? '收起提示' : '提示'}</button>` : ''}
      <button type="button" data-guided-action="next" ${canAdvance ? '' : 'disabled'}>${session.currentStepIndex === session.steps.length - 1 ? '完成' : '下一步'}<i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button></div>
      <div class="guided-learning-secondary-actions"><button type="button" data-guided-action="pause">暂时退出</button><button type="button" class="guided-learning-detail-link" data-guided-action="detailed">查看详细解析</button></div>
    </footer>
  </section>`;
}

export function renderGuidedLearningFailureCard(failure = {}, { sourceMessageId = '', failureId = '' } = {}) {
  return `<section class="guided-learning-failure-card" data-guided-failure-id="${esc(failureId)}" data-source-message-id="${esc(sourceMessageId)}" role="status">
    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><div><strong>互动教学没有准备好</strong><p>${text(failure.message || '请重试，或切换到详细解析。')}</p>
    <div><button type="button" data-guided-failure-action="retry">重试</button><button type="button" data-guided-failure-action="detailed">改用详细解析</button></div></div>
  </section>`;
}
