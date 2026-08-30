import { normalizeGuidedLearningSession } from './home-guided-learning.mjs';

const TARGET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'title', 'text'],
  properties: {
    type: { type: 'string', enum: ['word', 'phrase', 'sentence', 'paragraph', 'grammar', 'other'] },
    title: { type: 'string', minLength: 1, maxLength: 160 },
    text: { type: 'string', maxLength: 1800 }
  }
};

const STEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'title', 'content'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 80 },
    kind: { type: 'string', enum: ['explain', 'choice', 'free_response'] },
    title: { type: 'string', minLength: 1, maxLength: 120 },
    content: { type: 'string', minLength: 1, maxLength: 1600 },
    prompt: { type: 'string', maxLength: 700 },
    hint: { type: 'string', maxLength: 700 },
    choices: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 80 },
          text: { type: 'string', minLength: 1, maxLength: 320 }
        }
      }
    },
    correctChoiceId: { type: 'string', maxLength: 80 }
  }
};

export const CREATE_GUIDED_LEARNING_TOOL = Object.freeze({
  type: 'function',
  function: {
    name: 'create_guided_learning',
    description: '为当前英文单词、短语、句子或段落创建渐进式互动教学卡。每步只处理一个认知目标，不要在第一步直接给出完整解析。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['target', 'steps', 'closingSummary'],
      properties: {
        target: TARGET_SCHEMA,
        steps: { type: 'array', minItems: 2, maxItems: 7, items: STEP_SCHEMA },
        closingSummary: { type: 'string', minLength: 1, maxLength: 1000 }
      }
    }
  }
});

export const ADAPT_GUIDED_LEARNING_TOOL = Object.freeze({
  type: 'function',
  function: {
    name: 'adapt_guided_learning',
    description: '评价学习者对当前互动教学步骤的自由回答，并决定进入下一步还是提供更合适的线索后重试。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'feedback', 'nextAction'],
      properties: {
        outcome: { type: 'string', enum: ['correct', 'partial', 'incorrect'] },
        feedback: { type: 'string', minLength: 1, maxLength: 700 },
        nextAction: { type: 'string', enum: ['advance', 'retry'] },
        revisedContent: { type: 'string', maxLength: 1600 },
        revisedHint: { type: 'string', maxLength: 700 }
      }
    }
  }
});

export function createGuidedLearningArtifact(payload, { sessionId, sourceMessageId } = {}) {
  const session = normalizeGuidedLearningSession({
    ...payload,
    id: sessionId,
    sourceMessageId,
    status: 'active',
    currentStepIndex: 0,
    answers: {},
    hints: {},
    revision: 0
  });
  if (!session) throw new TypeError('Invalid guided learning payload');
  return { type: 'guided_learning', session };
}

export function createGuidedLearningUpdateArtifact(payload, { sessionId, expectedRevision, stepId } = {}) {
  const id = String(sessionId || '').trim().slice(0, 160);
  const step = String(stepId || '').trim().slice(0, 160);
  const revision = Number(expectedRevision);
  const outcome = String(payload?.outcome || '').trim();
  const feedback = String(payload?.feedback || '').trim().slice(0, 700);
  const nextAction = String(payload?.nextAction || '').trim();
  if (!id || !step || !Number.isInteger(revision) || revision < 0
    || !['correct', 'partial', 'incorrect'].includes(outcome)
    || !feedback || !['advance', 'retry'].includes(nextAction)) {
    throw new TypeError('Invalid guided learning update payload');
  }
  return {
    type: 'guided_learning_update',
    sessionId: id,
    expectedRevision: revision,
    stepId: step,
    outcome,
    feedback,
    nextAction,
    revisedContent: String(payload?.revisedContent || '').trim().slice(0, 1600),
    revisedHint: String(payload?.revisedHint || '').trim().slice(0, 700)
  };
}

export function guidedLearningSystemInstruction({ level = 'adaptive', difficulty = 'adaptive' } = {}) {
  return [
    '你正在为英语学习 App 创建互动教学。必须调用 create_guided_learning，不要另写一份普通长回答。',
    '一次只推进一个认知目标：先让学习者注意结构或线索，再解释，再用选择题或自由回答进行提取练习。',
    '不要在第一步给出完整答案、完整逐词解析或一次性倾倒全部知识；把信息分成 2–7 个短步骤。',
    '每一步最多提出一个问题。错误选项要有诊断价值；提示应提供线索而不是直接泄露答案。',
    '如果内容很简单，使用 2–3 步；只有确有必要才增加步骤。最后用简短总结收束。',
    `学习层级：${String(level || 'adaptive')}；当前难度：${String(difficulty || 'adaptive')}。`
  ].join('\n');
}

export function parseGuidedLearningJson(value) {
  const raw = String(value || '').trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
