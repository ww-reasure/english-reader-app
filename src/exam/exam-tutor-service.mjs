import { ExamTutorContextBuilder } from './exam-tutor-context.mjs';

export const EXAM_TUTOR_INITIAL_PROMPT = '请结合我的实际作答、正确答案、题目解析和定位证据，解释我为什么会错（或这道题的关键思路是什么），指出可能的思维误区，并给出下一次做题时可执行的一条提醒。';
export const TRANSLATION_TRAINING_SCORE_PROMPT = '请对我提交时保存的译文进行一次 AI 训练评分。';

const EXAM_TUTOR_SYSTEM_PROMPT = [
  '你是客观题 Exam Tutor，当前任务是离线真题学习辅导，不是修改标准答案。',
  'canonical correct answer 是只读事实，必须以提交时保存的 correctOptionKeyAtSubmit 为准。',
  '结合用户实际选项和不确定状态解释错误原因；优先引用题目已有的本地解析、evidence 和 evidenceTranslation。',
  '如果本地解析足够，不要编造新的“官方依据”；可以指出可能的思维误区，但不要声称系统已经确定用户具有某种长期能力缺陷。',
  '回答使用中文，必要时保留关键英文原句；不要改变题目、答案或用户历史结果。'
].join('\n');

const TRANSLATION_TUTOR_SYSTEM_PROMPT = [
  '你是翻译学习 Tutor。当前任务是基于提交时固定的译文、原文、参考译文和本地解析进行学习辅导，不是修改任何题库内容。',
  '用户译文、原文、参考译文、本地解析与复习状态均为只读事实；不得把 AI 推荐译法写成参考译文，也不得修改用户提交的译文或复习状态。',
  '回答使用中文，必要时保留关键英文原句。可以解释语义、句法和表达取舍，但不要声称系统已经确定用户具有某种长期能力缺陷。'
].join('\n');

const TRANSLATION_TRAINING_SYSTEM_PROMPT = [
  TRANSLATION_TUTOR_SYSTEM_PROMPT,
  '这是一次 AI 训练评分，仅供学习参考：内部训练分数范围只能是 0 到 10，不是任何官方考试评分，也不得映射或声称为考研、四级或其他考试的官方分数。',
  '主要从原文信息完整性、关键逻辑关系、词义理解、长难句结构处理和中文表达自然度给出反馈。',
  '只返回一个合法 JSON 对象，不要 Markdown、代码块或额外文字。JSON 必须严格包含：',
  '{"trainingScore":7.5,"summary":"...","strengths":["..."],"issues":[{"sourceFragment":"...","userFragment":"...","type":"...","explanation":"...","suggestion":"..."}],"improvedTranslation":"...","studyAdvice":"..."}'
].join('\n');

const FEEDBACK_FIELDS = ['sourceFragment', 'userFragment', 'type', 'explanation', 'suggestion'];

const requiredString = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`AI 训练反馈字段无效：${field}`);
  return value.trim();
};

export function validateTranslationTrainingFeedback(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('AI 训练反馈格式无效');
  const trainingScore = Number(payload.trainingScore);
  if (!Number.isFinite(trainingScore) || trainingScore < 0 || trainingScore > 10) {
    throw new Error('AI 训练评分必须在 0 到 10 之间');
  }
  if (!Array.isArray(payload.strengths) || !Array.isArray(payload.issues)) {
    throw new Error('AI 训练反馈字段无效：strengths 或 issues');
  }
  return {
    trainingScore,
    summary: requiredString(payload.summary, 'summary'),
    strengths: payload.strengths.slice(0, 8).map((item, index) => requiredString(item, `strengths[${index}]`)),
    issues: payload.issues.slice(0, 8).map((issue, index) => {
      if (!issue || typeof issue !== 'object' || Array.isArray(issue)) throw new Error(`AI 训练反馈字段无效：issues[${index}]`);
      return Object.fromEntries(FEEDBACK_FIELDS.map(field => [field, requiredString(issue[field], `issues[${index}].${field}`)]));
    }),
    improvedTranslation: requiredString(payload.improvedTranslation, 'improvedTranslation'),
    studyAdvice: requiredString(payload.studyAdvice, 'studyAdvice')
  };
}

export function formatTranslationTrainingFeedback(feedback) {
  const score = Number(feedback.trainingScore).toFixed(1).replace(/\.0$/, '');
  const strengths = feedback.strengths.map(item => `- ${item}`).join('\n') || '- 暂无';
  const issues = feedback.issues.map((issue, index) => [
    `${index + 1}. ${issue.type}`,
    `   原文：${issue.sourceFragment}`,
    `   你的表达：${issue.userFragment}`,
    `   ${issue.explanation}`,
    `   建议：${issue.suggestion}`
  ].join('\n')).join('\n') || '未发现需要特别指出的问题。';
  return [
    `**${score} / 10**`,
    'AI 训练评分，仅供学习参考',
    `### 总体评价\n${feedback.summary}`,
    `### 做得好的地方\n${strengths}`,
    `### 需要改进\n${issues}`,
    `### AI 推荐译法\n${feedback.improvedTranslation}`,
    `### 学习建议\n${feedback.studyAdvice}`
  ].join('\n\n');
}

export function findLatestTranslationTrainingFeedback(session) {
  const message = [...(session?.messages || [])].reverse().find(item => item?.kind === 'translation_training_feedback');
  if (!message?.feedback) return null;
  try {
    return validateTranslationTrainingFeedback(message.feedback);
  } catch {
    return null;
  }
}

const clipMessage = message => {
  const content = String(message?.content ?? '');
  if (!message?.quote?.selectedText) return content.slice(0, 4000);
  return `引用（${message.quote.selectedSource || 'question'}）：“${message.quote.selectedText}”\n${content}`.slice(0, 4000);
};

export class ExamTutorMessageBuilder {
  build({ kind = 'exam', messages = [], userMessage = '', pageContext = null }) {
    const transcript = messages
      .filter(message => (message?.kind === 'text' || message?.kind === 'translation_training_feedback') && (message.role === 'user' || message.role === 'assistant'))
      .slice(-24)
      .map(message => ({ role: message.role, content: clipMessage(message) }));
    const latest = transcript.at(-1);
    const currentUserMessage = String(userMessage || '').trim();
    if (!latest || latest.role !== 'user' || latest.content !== currentUserMessage) {
      transcript.push({ role: 'user', content: currentUserMessage });
    }
    return [
      { role: 'system', content: kind === 'translation_training_feedback' ? TRANSLATION_TRAINING_SYSTEM_PROMPT : kind === 'translation' ? TRANSLATION_TUTOR_SYSTEM_PROMPT : EXAM_TUTOR_SYSTEM_PROMPT },
      {
        role: 'system',
        content: '以下是提交时固定的 Exam Tutor context，只能作为只读事实使用：\n' + JSON.stringify(pageContext?.exam || {})
      },
      ...transcript
    ];
  }
}

export class ExamTutorService {
  constructor({ chatService, conversationStore, contextBuilder = new ExamTutorContextBuilder() }) {
    this.chatService = chatService;
    this.conversationStore = conversationStore;
    this.contextBuilder = contextBuilder;
  }

  getConversation(input) {
    const tutorContext = this.contextBuilder.build(input);
    return {
      tutorContext,
      sessionKey: tutorContext.conversationKey,
      session: this.conversationStore.getSession(tutorContext.conversationKey)
    };
  }

  async ask({ userMessage, ...input }) {
    const currentMessage = String(userMessage || '').trim();
    if (!currentMessage) throw new Error('Exam Tutor 消息不能为空');
    const { tutorContext, sessionKey, session } = this.getConversation(input);
    const reply = await this.chatService.ask({
      sessionKey,
      session,
      userMessage: currentMessage,
      kind: tutorContext.kind,
      pageContext: tutorContext.pageContext,
      tools: []
    });
    this.conversationStore.append(sessionKey, {
      role: 'user',
      kind: 'text',
      content: currentMessage,
      ...(input.quote?.selectedText ? { quote: { selectedText: String(input.quote.selectedText), selectedSource: String(input.quote.selectedSource || 'question') } } : {})
    });
    this.conversationStore.append(sessionKey, {
      role: 'assistant',
      kind: 'text',
      content: String(reply?.content || '')
    });
    return {
      tutorContext,
      sessionKey,
      reply,
      session: this.conversationStore.getSession(sessionKey)
    };
  }

  getTranslationTrainingFeedback(input) {
    const { tutorContext, sessionKey, session } = this.getConversation(input);
    if (tutorContext.kind !== 'translation') throw new Error('仅翻译题可进行 AI 训练评分');
    return { tutorContext, sessionKey, session, feedback: findLatestTranslationTrainingFeedback(session) };
  }

  async scoreTranslation(input) {
    const { tutorContext, sessionKey, session, feedback: existingFeedback } = this.getTranslationTrainingFeedback(input);
    if (!tutorContext.pageContext.exam.translation.userTranslationAtSubmit.trim()) throw new Error('本题未填写译文');
    if (existingFeedback) return { tutorContext, sessionKey, feedback: existingFeedback, session, cached: true };
    const reply = await this.chatService.ask({
      sessionKey,
      session,
      userMessage: TRANSLATION_TRAINING_SCORE_PROMPT,
      kind: 'translation_training_feedback',
      pageContext: tutorContext.pageContext,
      tools: [],
      responseFormat: { type: 'json_object' },
      temperature: 0.2
    });
    let payload;
    try {
      payload = JSON.parse(String(reply?.content || ''));
    } catch {
      throw new Error('AI 返回的训练评分格式无效，请重试');
    }
    const feedback = validateTranslationTrainingFeedback(payload);
    this.conversationStore.append(sessionKey, {
      role: 'user',
      kind: 'text',
      content: TRANSLATION_TRAINING_SCORE_PROMPT
    });
    this.conversationStore.append(sessionKey, {
      role: 'assistant',
      kind: 'translation_training_feedback',
      content: formatTranslationTrainingFeedback(feedback),
      feedback
    });
    return {
      tutorContext,
      sessionKey,
      feedback,
      session: this.conversationStore.getSession(sessionKey),
      cached: false
    };
  }
}
