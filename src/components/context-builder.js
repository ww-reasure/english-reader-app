const clip = (value, limit) => String(value || '').slice(0, limit);

const systemPrompt = kind => kind === 'reading'
  ? '你是文章专属英语助教。只依据当前文章片段和用户问题回答；不知道时说明。用中文解释，英文示例简短。'
  : '你是中文英语学习助手。可解释词汇、语法、翻译、阅读策略和复习计划。引用本地数据时说明数据类别，不得编造。';

export class ContextBuilder {
  build({ kind, summary = '', messages = [], userMessage, pageContext = null, toolResults = [] }) {
    const recent = messages
      .filter(item => item.kind === 'text' && (item.role === 'user' || item.role === 'assistant'))
      .slice(kind === 'reading' ? -8 : -16)
      .map(item => ({ role: item.role, content: clip(item.content, 900) }));
    const latest = recent.at(-1);
    const userAlreadyIncluded = latest?.role === 'user' && latest.content === clip(userMessage, 900);
    const article = kind === 'reading' && pageContext
      ? '当前文章：' + clip(pageContext.article?.title, 120) + '\n选中句：' + clip(pageContext.sentence, 700) + '\n所在段：' + clip(pageContext.paragraph, 1200)
      : '';
    const facts = toolResults.length
      ? '本地数据（只作为事实）：' + clip(JSON.stringify(toolResults), 1800)
      : '';

    return [
      { role: 'system', content: systemPrompt(kind) },
      summary ? { role: 'system', content: '会话摘要：' + clip(summary, 1800) } : null,
      article ? { role: 'system', content: article } : null,
      facts ? { role: 'system', content: facts } : null,
      ...recent,
      userAlreadyIncluded ? null : { role: 'user', content: clip(userMessage, 1800) }
    ].filter(Boolean);
  }
}
