const clip = (value, limit) => String(value || '').slice(0, limit);
const normalizeExcerpt = value => String(value || '').replace(/\s+/g, ' ').trim();

const systemPrompt = kind => kind === 'reading'
  ? '你是文章专属英语助教。只依据当前文章片段、当前句子详解和用户问题回答；不知道时说明。用户提及“上面的仿写句、例句、它”等指代时，必须优先引用当前句子详解中的对应内容，不得改为解释原选句。若提供“当前追问引用”，用户提及“这段、这里、它”时优先解释该引用。用中文解释，英文示例简短。'
  : '你是中文英语学习助手。可解释词汇、语法、翻译、阅读策略和复习计划。引用本地数据时说明数据类别，不得编造。用户要求基于学习情况定制一篇练习阅读时，调用 generate_reading 工具；不要在聊天正文中创作完整文章。';

export class ContextBuilder {
  build({ kind, summary = '', messages = [], userMessage, pageContext = null, toolResults = [] }) {
    const latestSelectedExcerpt = [...messages].reverse().find(item => item.kind === 'text' && item.selectedExcerpt)?.selectedExcerpt;
    const selectedExcerpt = kind === 'reading'
      ? clip(normalizeExcerpt(pageContext?.selectedExcerpt || latestSelectedExcerpt), 600)
      : '';
    const recent = messages
      .filter(item => item.kind === 'text' && (item.role === 'user' || item.role === 'assistant'))
      .slice(kind === 'reading' ? -8 : -16)
      .map(item => ({ role: item.role, content: clip(item.content, 900) }));
    const latest = recent.at(-1);
    const userAlreadyIncluded = latest?.role === 'user' && latest.content === clip(userMessage, 900);
    const article = kind === 'reading' && pageContext
      ? '当前文章：' + clip(pageContext.article?.title, 120) + '\n选中句：' + clip(pageContext.sentence, 700) + '\n所在段：' + clip(pageContext.paragraph, 1200) + (pageContext.analysis ? '\n当前句子详解（含仿写）：' + clip(pageContext.analysis, 5000) : '') + (selectedExcerpt ? '\n当前追问引用（优先解释此段）：' + selectedExcerpt : '')
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
