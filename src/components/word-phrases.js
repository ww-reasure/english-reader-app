import { API } from '../api.js';
import { createWordPhrases } from './word-phrases.mjs';

async function requestWordPhrases(word, { signal } = {}) {
  const prompt = `为英文单词 "${word}" 提供 3-5 个最常用、最值得学习的固定搭配或词组。只返回 JSON：\n{\n  "phrases": [\n    { "phrase": "graduate from", "glossZh": "毕业于" }\n  ]\n}\n要求：每条 phrase 必须包含目标单词或其常见词形；glossZh 必须是简洁中文；不要给同根词、完整例句、专业冷僻搭配或重复项。`;
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

export const WordPhrases = createWordPhrases({ request: requestWordPhrases });
