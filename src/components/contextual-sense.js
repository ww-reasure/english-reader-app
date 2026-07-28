import { API } from '../api.js';
import { createContextualSense } from './contextual-sense.mjs';

async function requestContextualSense({ word, sentence, senses }, { signal } = {}) {
  const candidates = senses.map((sense, index) => `${index}. ${sense.pos || '未知词性'}：${sense.glossZh}`).join('\n');
  const data = await API.fetch('/chat/completions', {
    messages: [
      {
        role: 'system',
        content: `你只能从给定词典候选义项中选择最符合句子的一个；不得新增、改写或翻译义项。只返回 JSON：
{ "senseIndex": 0, "reasonZh": "不超过 60 字的中文选择理由" }
senseIndex 必须是候选列表里的整数。若无法可靠判断，返回 { "senseIndex": -1, "reasonZh": "无法可靠判断" }。`
      },
      { role: 'user', content: `单词：${word}\n句子：${sentence}\n候选义项：\n${candidates}` }
    ],
    response_format: { type: 'json_object' },
    temperature: 0
  }, 30000, signal);
  return JSON.parse(data?.choices?.[0]?.message?.content || '{}');
}

export const ContextualSense = createContextualSense({ request: requestContextualSense });
