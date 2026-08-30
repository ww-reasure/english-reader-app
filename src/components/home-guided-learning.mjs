export const HOME_LEARNING_RESPONSE_MODES = Object.freeze({
  ASK: 'ask',
  DETAILED: 'detailed',
  GUIDED: 'guided'
});

const VALID_RESPONSE_MODES = new Set(Object.values(HOME_LEARNING_RESPONSE_MODES));
const VALID_STEP_KINDS = new Set(['explain', 'choice', 'free_response']);
const VALID_SESSION_STATUSES = new Set(['active', 'paused', 'completed', 'failed']);
const MAX_STEPS = 7;

const clip = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const safeId = value => clip(value, 160).replace(/[^a-z0-9._:-]/gi, '-');

export function normalizeHomeLearningResponseMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return VALID_RESPONSE_MODES.has(mode) ? mode : HOME_LEARNING_RESPONSE_MODES.ASK;
}

const routeForPreference = preference => {
  const mode = normalizeHomeLearningResponseMode(preference);
  if (mode === HOME_LEARNING_RESPONSE_MODES.DETAILED) return 'detailed';
  if (mode === HOME_LEARNING_RESPONSE_MODES.GUIDED) return 'guided';
  return 'choose';
};

const hasEnglish = value => /[A-Za-z]/.test(value);
const hasChinese = value => /[\u3400-\u9fff]/.test(value);
const isBareEnglishLearningInput = value => {
  if (!hasEnglish(value) || hasChinese(value)) return false;
  const letters = (value.match(/[A-Za-z]/g) || []).length;
  const nonWhitespace = value.replace(/\s/g, '').length || 1;
  return letters / nonWhitespace >= 0.55 && value.length <= 1800;
};

const EXPLICIT_DIRECT = /只(?:要|需)?(?:翻译|答案|结论)|只翻译|直接(?:告诉|说|给)(?:我)?(?:答案|结论|意思)|翻译一下|怎么翻译|什么意思|怎么读|发音/;
const EXPLICIT_GUIDED = /一步一步|一步步|带我(?:一起)?学|带着我学|教我(?:学会|理解|掌握|学习)?|互动教学|练习到会|引导我/;
const EXPLICIT_DETAILED = /详细(?:解析|分析|讲解)|完整(?:解析|分析|讲解)|全面(?:解析|分析|讲解)/;
const ORDINARY_HOME_REQUEST = /生成(?:一篇|文章|阅读)|来一篇|学习日报|今日(?:学习|日报)|总结今天|复习计划|学习计划|最近学习|联网|搜索|查一下/;
const AMBIGUOUS_LEARNING = /帮我(?:看看|解答|分析|讲讲)(?:这个|这句|这段)?|看看这个|看一下这个|这个怎么理解|这(?:句|段)看不懂|我看不懂/;

export function classifyHomeLearningRequest(value, preference = HOME_LEARNING_RESPONSE_MODES.ASK) {
  const text = clip(value, 2400);
  if (!text) return { route: 'normal', reason: 'ordinary_chat' };
  if (EXPLICIT_DIRECT.test(text)) return { route: 'normal', reason: 'explicit_direct' };
  if (EXPLICIT_GUIDED.test(text)) return { route: 'guided', reason: 'explicit_guided' };
  if (EXPLICIT_DETAILED.test(text)) return { route: 'detailed', reason: 'explicit_detailed' };
  if (ORDINARY_HOME_REQUEST.test(text)) return { route: 'normal', reason: 'ordinary_chat' };
  if (isBareEnglishLearningInput(text)) return { route: routeForPreference(preference), reason: 'bare_english' };
  if (hasEnglish(text) && AMBIGUOUS_LEARNING.test(text)) {
    return { route: routeForPreference(preference), reason: 'ambiguous_learning' };
  }
  return { route: 'normal', reason: 'ordinary_chat' };
}

const normalizeChoice = value => {
  const id = safeId(value?.id);
  const text = clip(value?.text, 320);
  return id && text ? { id, text } : null;
};

const normalizeStep = value => {
  const id = safeId(value?.id);
  const kind = String(value?.kind || '').trim();
  const title = clip(value?.title, 120);
  const content = clip(value?.content, 1600);
  const prompt = clip(value?.prompt, 700);
  const hint = clip(value?.hint, 700);
  if (!id || !VALID_STEP_KINDS.has(kind) || !title || !content) return null;

  const step = { id, kind, title, content };
  if (hint) step.hint = hint;
  if (kind === 'choice') {
    const choices = (Array.isArray(value?.choices) ? value.choices : [])
      .map(normalizeChoice)
      .filter(Boolean)
      .slice(0, 5);
    const choiceIds = new Set(choices.map(choice => choice.id));
    const correctChoiceId = safeId(value?.correctChoiceId);
    if (!prompt || choices.length < 2 || choiceIds.size !== choices.length || !choiceIds.has(correctChoiceId)) return null;
    step.prompt = prompt;
    step.choices = choices;
    step.correctChoiceId = correctChoiceId;
  }
  if (kind === 'free_response') {
    if (!prompt) return null;
    step.prompt = prompt;
  }
  return step;
};

const normalizeAnswers = (value, steps) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const stepIds = new Set(steps.map(step => step.id));
  return Object.fromEntries(Object.entries(value).flatMap(([stepId, answer]) => {
    if (!stepIds.has(stepId) || !answer || typeof answer !== 'object') return [];
    const type = answer.type === 'choice' ? 'choice' : answer.type === 'free_response' ? 'free_response' : '';
    const response = clip(answer.value, 1200);
    if (!type || !response) return [];
    return [[stepId, {
      type,
      value: response,
      ...(typeof answer.correct === 'boolean' ? { correct: answer.correct } : {}),
      ...(answer.feedback ? { feedback: clip(answer.feedback, 700) } : {})
    }]];
  }));
};

const normalizeHints = (value, steps) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const stepIds = new Set(steps.map(step => step.id));
  return Object.fromEntries(Object.entries(value)
    .filter(([stepId, shown]) => stepIds.has(stepId) && shown === true)
    .map(([stepId]) => [stepId, true]));
};

export function normalizeGuidedLearningSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = safeId(value.id);
  const sourceMessageId = safeId(value.sourceMessageId);
  const rawSteps = Array.isArray(value.steps) ? value.steps : [];
  if (!id || !sourceMessageId || rawSteps.length < 2 || rawSteps.length > MAX_STEPS) return null;
  const steps = rawSteps.map(normalizeStep);
  if (steps.some(step => !step)) return null;
  const stepIds = new Set(steps.map(step => step.id));
  if (stepIds.size !== steps.length) return null;

  const target = {
    type: clip(value.target?.type, 48) || 'other',
    title: clip(value.target?.title, 160) || '互动教学',
    text: clip(value.target?.text, 1800)
  };
  const currentStepIndex = Math.max(0, Math.min(
    steps.length - 1,
    Number.isInteger(Number(value.currentStepIndex)) ? Math.trunc(Number(value.currentStepIndex)) : 0
  ));
  const status = VALID_SESSION_STATUSES.has(value.status) ? value.status : 'active';
  const revision = Math.max(0, Number.isInteger(Number(value.revision)) ? Math.trunc(Number(value.revision)) : 0);

  return {
    schemaVersion: 1,
    id,
    sourceMessageId,
    status,
    target,
    steps,
    currentStepIndex,
    answers: normalizeAnswers(value.answers, steps),
    hints: normalizeHints(value.hints, steps),
    revision,
    closingSummary: clip(value.closingSummary, 1000)
  };
}

export function setGuidedLearningStep(value, index) {
  const session = normalizeGuidedLearningSession(value);
  if (!session) return null;
  const currentStepIndex = Math.max(0, Math.min(session.steps.length - 1, Math.trunc(Number(index) || 0)));
  if (currentStepIndex === session.currentStepIndex) return session;
  return { ...session, currentStepIndex, revision: session.revision + 1 };
}

export function toggleGuidedLearningHint(value, stepId, shown = true) {
  const session = normalizeGuidedLearningSession(value);
  if (!session || !session.steps.some(step => step.id === stepId)) return session;
  const hints = { ...session.hints };
  if (shown) hints[stepId] = true;
  else delete hints[stepId];
  return { ...session, hints, revision: session.revision + 1 };
}

export function recordGuidedChoice(value, { stepId, choiceId } = {}) {
  const session = normalizeGuidedLearningSession(value);
  const step = session?.steps.find(item => item.id === stepId);
  if (!session || step?.kind !== 'choice' || !step.choices.some(choice => choice.id === choiceId)) return session;
  return {
    ...session,
    answers: {
      ...session.answers,
      [stepId]: { type: 'choice', value: choiceId, correct: step.correctChoiceId === choiceId }
    },
    revision: session.revision + 1
  };
}

export function recordGuidedFreeResponse(value, { stepId, value: response, outcome, feedback = '', revisedContent = '', revisedHint = '' } = {}) {
  const session = normalizeGuidedLearningSession(value);
  const stepIndex = session?.steps.findIndex(item => item.id === stepId) ?? -1;
  const step = stepIndex >= 0 ? session.steps[stepIndex] : null;
  const answer = clip(response, 1200);
  if (!session || step?.kind !== 'free_response' || !answer || !['correct', 'partial', 'incorrect'].includes(outcome)) return session;
  const steps = [...session.steps];
  if (revisedContent || revisedHint) {
    steps[stepIndex] = {
      ...step,
      ...(revisedContent ? { content: clip(revisedContent, 1600) } : {}),
      ...(revisedHint ? { hint: clip(revisedHint, 700) } : {})
    };
  }
  return {
    ...session,
    steps,
    answers: {
      ...session.answers,
      [stepId]: {
        type: 'free_response',
        value: answer,
        correct: outcome === 'correct',
        feedback: clip(feedback, 700)
      }
    },
    revision: session.revision + 1
  };
}

export function advanceGuidedLearning(value) {
  const session = normalizeGuidedLearningSession(value);
  if (!session) return null;
  if (session.currentStepIndex >= session.steps.length - 1) {
    if (session.status === 'completed') return session;
    return { ...session, status: 'completed', revision: session.revision + 1 };
  }
  return {
    ...session,
    status: 'active',
    currentStepIndex: session.currentStepIndex + 1,
    revision: session.revision + 1
  };
}

export function setGuidedLearningStatus(value, status) {
  const session = normalizeGuidedLearningSession(value);
  if (!session || !VALID_SESSION_STATUSES.has(status) || session.status === status) return session;
  return { ...session, status, revision: session.revision + 1 };
}
