const clip = (value, limit) => String(value || '').slice(0, limit);
const normalizeExcerpt = value => String(value || '').replace(/\s+/g, ' ').trim();
const compactNumber = value => Number.isFinite(Number(value)) ? String(Number(value)) : '未知';

const formatHomeActivity = message => {
  if (message?.kind === 'article') {
    const article = message.article || {};
    const title = clip(article.title, 160) || '未命名文章';
    const titleZh = clip(article.titleZh, 160);
    const difficulty = clip(article.difficulty, 32) || '未标注难度';
    const topic = clip(article.topic, 80) || '综合';
    const body = clip(normalizeExcerpt(article.content), 2400);
    return [
      '[生成成功]',
      `时间：${compactNumber(message.createdAt)}`,
      `标题：${title}${titleZh ? `（${titleZh}）` : ''}`,
      `难度：${difficulty}`,
      `主题：${topic}`,
      `词数：${compactNumber(article.wordCount)}`,
      body ? `正文节选：${body}` : ''
    ].filter(Boolean).join('\n');
  }
  if (message?.kind === 'generation_failure') {
    const failure = message.failure || {};
    const generation = failure.generation || {};
    const request = clip(normalizeExcerpt(generation.request), 500);
    return [
      '[生成未完成]',
      `时间：${compactNumber(message.createdAt)}`,
      `原因：${clip(normalizeExcerpt(failure.message), 700) || '文章生成未完成'}`,
      `规格：${clip(generation.difficulty, 32) || '未标注难度'} / ${clip(generation.challenge, 32) || '未标注模式'} / ${compactNumber(generation.wordCount)} 词`,
      request ? `请求：${request}` : ''
    ].filter(Boolean).join('\n');
  }
  return '';
};

const formatStructuredHomeActivity = activity => {
  const articles = Array.isArray(activity?.articles)
    ? activity.articles
    : activity?.article ? [activity.article] : [];
  const articleFacts = articles.slice(0, 4).map(article => [
    `文章：${clip(article?.title, 160) || '未命名文章'}`,
    `难度：${clip(article?.difficulty, 32) || '未标注难度'}`,
    `词数：${compactNumber(article?.wordCount)}`
  ].join('；')).join('\n');
  return [
    `[活动：${clip(activity?.type, 48) || 'generation'} / ${clip(activity?.status, 48) || 'unknown'}]`,
    `开始：${compactNumber(activity?.startedAt)}`,
    `完成：${compactNumber(activity?.completedAt)}`,
    activity?.elapsedMs == null ? '耗时：旧记录未保存耗时' : `耗时毫秒：${compactNumber(activity.elapsedMs)}`,
    Number.isFinite(Number(activity?.coveredWordCount)) ? `已覆盖复习词：${Number(activity.coveredWordCount)}` : '',
    Number.isFinite(Number(activity?.failedWordCount)) ? `未覆盖/失败词：${Number(activity.failedWordCount)}` : '',
    articleFacts,
    activity?.failureReason ? `失败原因：${clip(normalizeExcerpt(activity.failureReason), 700)}` : ''
  ].filter(Boolean).join('\n');
};

const systemPrompt = (kind, capabilityIndex = '') => kind === 'reading'
  ? '你是文章专属英语助教。只依据当前文章片段、当前句子详解和用户问题回答；不知道时说明。用户提及“上面的仿写句、例句、它”等指代时，必须优先引用当前句子详解中的对应内容，不得改为解释原选句。若提供“当前追问引用”，用户提及“这段、这里、它”时优先解释该引用。用中文解释，英文示例简短。'
  : `你是中文英语学习助手，也熟悉当前 App 的真实功能。可解释词汇、语法、翻译、阅读策略和复习计划。引用本地数据时说明数据类别，不得编造。

功能索引（稳定版本；需要前置条件或限制时调用 get_app_capabilities 查询详情）：
${capabilityIndex}

制定学习计划时，先调用 get_learning_overview、get_review_queue、get_exam_learning_priorities 和 get_recent_learning_activity，按真实数据给出 2–4 步；需要可执行入口时调用 offer_app_actions，最多三个按钮，必须等用户点击，禁止自动导航或自动开始复习。

工具规则：只有当前用户消息明确要求生成、来一篇、继续生成英语阅读，或明确确认刚提出的阅读建议时，才调用 generate_reading；可先读取词库、收藏和复习数据来定制。不得仅凭历史文章、历史失败记录、模糊语气词或用户追问而生成新文章。“这是什么类型的文章”“为什么只生成一篇”“啊？”等必须普通回答，不调用写入工具。生成时不得在聊天正文创作整篇文章，成功后只说明已完成并交付阅读卡片。`;

export class ContextBuilder {
  constructor({ capabilityIndex = '' } = {}) {
    this.capabilityIndex = String(capabilityIndex || '');
  }

  build({ kind, summary = '', messages = [], activities = [], userMessage, pageContext = null, toolResults = [] }) {
    const latestSelectedExcerpt = [...messages].reverse().find(item => item.kind === 'text' && item.selectedExcerpt)?.selectedExcerpt;
    const selectedExcerpt = kind === 'reading'
      ? clip(normalizeExcerpt(pageContext?.selectedExcerpt || latestSelectedExcerpt), 600)
      : '';
    const hasActivityEvents = kind === 'home' && messages.some(item => item.kind === 'activity');
    const recent = messages
      .filter(item => item.kind === 'text' && (item.role === 'user' || item.role === 'assistant') || (kind === 'home' && item.kind === 'activity'))
      .slice(kind === 'reading' ? -8 : -72)
      .map(item => item.kind === 'activity'
        ? { role: 'system', content: '真实活动事件：\n' + clip(formatStructuredHomeActivity(item.activity), 1800) }
        : { role: item.role, content: clip(item.content, 900) });
    const latestUser = [...recent].reverse().find(item => item.role === 'user');
    const userAlreadyIncluded = latestUser?.content === clip(userMessage, 900);
    const article = kind === 'reading' && pageContext
      ? '当前文章：' + clip(pageContext.article?.title, 120) + '\n选中句：' + clip(pageContext.sentence, 700) + '\n所在段：' + clip(pageContext.paragraph, 1200) + (pageContext.analysis ? '\n当前句子详解（含仿写）：' + clip(pageContext.analysis, 5000) : '') + (selectedExcerpt ? '\n当前追问引用（优先解释此段）：' + selectedExcerpt : '')
      : '';
    const facts = toolResults.length
      ? '本地数据（只作为事实）：' + clip(JSON.stringify(toolResults), 1800)
      : '';
    const structuredHomeActivity = kind === 'home' && !hasActivityEvents && activities.length
      ? activities.slice(-6).map(formatStructuredHomeActivity).filter(Boolean).join('\n\n')
      : '';
    const legacyHomeActivity = kind === 'home' && !structuredHomeActivity
      ? messages
        .filter(item => item.kind === 'article' || item.kind === 'generation_failure')
        .slice(-6)
        .map(formatHomeActivity)
        .filter(Boolean)
      .join('\n\n')
      : '';

    return [
      { role: 'system', content: systemPrompt(kind, this.capabilityIndex) },
      summary ? { role: 'system', content: '会话摘要：' + clip(summary, 1800) } : null,
      article ? { role: 'system', content: article } : null,
      structuredHomeActivity ? { role: 'system', content: '近期真实活动账本（回答刚刚生成、部分成功、耗时等问题时只能以此为准；不得编造或否认）：\n' + clip(structuredHomeActivity, 6000) } : null,
      legacyHomeActivity ? { role: 'system', content: '近期文章生成活动（真实结果，回答时以此为准）：\n' + clip(legacyHomeActivity, 6000) } : null,
      facts ? { role: 'system', content: facts } : null,
      ...recent,
      userAlreadyIncluded ? null : { role: 'user', content: clip(userMessage, 1800) }
    ].filter(Boolean);
  }
}
