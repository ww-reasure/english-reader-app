import { API } from '../api.js';
import { createWordSimilar } from './word-similar.mjs';

async function requestWordSimilar(word, { signal } = {}) {
  const prompt = `为英文单词 "${word}" 提供 3-5 个最常用的近义词或语义相近词。只返回 JSON：\n{\n  "similar": [\n    { "word": "significant", "glossZh": "重要的；显著的", "nuanceZh": "强调影响或意义" }\n  ]\n}\n要求：每条 word 必须是单个英文单词，不能是目标词本身或其词形变化；glossZh 必须是简洁中文；nuanceZh 用简短中文说明细微差异；不要给反义词、同根词、短语、专有名词、冷僻词或重复项。`;
  const data = await API.fetch('/chat/completions', {
    messages: [
      { role: 'system', content: '你是英语词汇教师。只返回符合要求的 JSON，不要解释。' },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.25
  }, 60000, signal);
  const content = data?.choices?.[0]?.message?.content;
  return JSON.parse(content || '{}');
}

export const WordSimilar = createWordSimilar({ request: requestWordSimilar });
