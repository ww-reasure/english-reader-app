import { API } from '../api.js';
import { createSentenceGuide } from './sentence-guide.mjs';

async function requestSentenceGuide({ sentence, paragraph, article, targetTrack }, { signal } = {}) {
  const data = await API.fetch('/chat/completions', {
    messages: [
      {
        role: 'system',
        content: `你是英语逐句导读助手。只返回 JSON，不要 Markdown、HTML 或额外文字。
返回结构：
{
  "translationZh": "自然中文意译",
  "chunks": [{ "source": "必须是原句中的连续英文片段", "glossZh": "对应中文" }],
  "grammar": ["最多三条简短中文语法提示"],
  "keywords": [{ "word": "原句中的英文单词", "glossZh": "简短中文释义" }]
}
translationZh 和每条 glossZh 必须是中文。chunks 必须切分原句，不得改写原文；grammar 与 keywords 均可为空数组。`
      },
      {
        role: 'user',
        content: [
          `目标轨道：${targetTrack || 'general'}`,
          article?.title ? `文章：${article.title}` : '',
          paragraph ? `段落：${paragraph}` : '',
          `当前句：${sentence}`
        ].filter(Boolean).join('\n\n')
      }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.25
  }, 60000, signal);
  return JSON.parse(data?.choices?.[0]?.message?.content || '{}');
}

export const SentenceGuide = createSentenceGuide({ request: requestSentenceGuide });
