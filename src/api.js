/**
 * API Module
 * Handles all AI API calls (DeepSeek)
 */

import { Config } from './config.js';
import { formatProfileConstraints, getDifficultyProfile } from './difficulty-profile.mjs';

const VOCABULARY_GUIDANCE = {
  cet4: {
    support: '优先使用高频词汇和基础学术词，避免堆砌生僻词。',
    standard: '以可追溯的通用高频词和常见学术词为主，适度使用抽象表达。',
    stretch: '以通用高频词为骨架，可加入适量进阶学术词，但保持语义自然。'
  },
  cet6: {
    support: '以通用高频词和常见学术词为主，优先保证清晰可读。',
    standard: '使用可追溯的通用高频词和常见学术词，保持语篇清晰。',
    stretch: '以通用高频词为骨架，适量使用进阶学术词，避免为难度而堆词。'
  },
  kaoyan1: {
    support: '以高频词和通用学术词为主，优先保证英语一导向训练的自然可读。',
    standard: '使用通用高频词与常见学术表达，保持英语一导向的论证自然完整。',
    stretch: '使用通用高频词与适量进阶学术表达，避免不自然的术语堆砌。'
  },
  kaoyan2: {
    support: '以高频词和通用学术词为主，优先保证英语二导向训练的清晰可读。',
    standard: '使用通用高频词与常见学术表达，保持英语二导向的文章逻辑清楚。',
    stretch: '使用通用高频词与适量进阶学术表达，避免为难度而堆词。'
  },
  graduate: {
    support: '使用通用高频词和社科学术表达，优先保证可读性。',
    standard: '使用通用高频词和常见学术表达，保持论证自然完整。',
    stretch: '使用通用高频词和适量进阶学术表达，避免不自然的术语堆砌。'
  }
};

const MAX_GENERATION_PREFERENCE_LENGTH = 2400;
const MAX_VALIDATION_CORRECTION_LENGTH = 1800;
const CONSERVATIVE_CORE_GUIDANCE = '- 材料构成硬性检查：至少 90% 的可词形还原词次来自可追溯核心频率层，且至少 80% 来自 NGSL 1-3 层；NGSL 4 及以上词次不超过 12%。这些是材料来源约束，不是学习者掌握率。';

const clipText = (value, limit) => String(value || '').trim().slice(0, limit);
const CHINESE_TEXT = /[\u3400-\u9fff]/u;

function validChineseTranslation(value) {
  const translation = String(value || '').trim();
  return CHINESE_TEXT.test(translation) ? translation : null;
}

const resolveArticleSpecification = (difficulty, wordCount, profile) => {
  const selectedProfile = getDifficultyProfile(profile?.track || difficulty, profile?.challenge);
  const requestedWordCount = Number.parseInt(wordCount, 10);
  const desiredWordCount = Math.max(
    selectedProfile.wordRange.min,
    Math.min(
      selectedProfile.wordRange.max,
      Number.isFinite(requestedWordCount) ? requestedWordCount : selectedProfile.wordRange.min
    )
  );

  return {
    profile: selectedProfile,
    wordCount: desiredWordCount
  };
};

const preferenceWithoutCorrection = (prompt, correction) => {
  const rawPreference = String(prompt || '').trim();
  const rawCorrection = String(correction || '').trim();
  const preference = rawCorrection && rawPreference.endsWith(rawCorrection)
    ? rawPreference.slice(0, -rawCorrection.length).trim()
    : rawPreference;
  return clipText(preference, MAX_GENERATION_PREFERENCE_LENGTH);
};

const buildPersonalizationGuidance = personalization => {
  if (personalization?.mode === 'evidence_collecting') {
    return [
      '- 学习者初测已完成，当前继续收集独立证据：优先高频核心词、清晰衔接和可读句法。',
      CONSERVATIVE_CORE_GUIDANCE,
      '- 不得声称具体覆盖率、读者确定掌握比例或任何能力结论。'
    ].join('\n');
  }
  if (personalization?.mode === 'evidence_calibrated') {
    const targetCoverage = Number(personalization.targetCoverage);
    if (Number.isFinite(targetCoverage) && targetCoverage >= 0 && targetCoverage <= 100) {
      return [
        `- 本轮材料匹配目标为预计掌握覆盖约 ${targetCoverage}%。`,
        '- 该数字仅供本地词汇/个人证据校验使用；不得把它写成学习者的词汇量或确定能力结论。',
        '- 若无法自然满足该约束，宁可保持文本自然并让本地校验请求精修。'
      ].join('\n');
    }
  }
  return [
    '- 当前为未校准保守模式：优先高频基础词、较短句和清晰衔接，只少量加入目标考试导向词。',
    CONSERVATIVE_CORE_GUIDANCE,
    '- 不得声称具体覆盖率、词汇量，或“读者大概率认识”的比例。'
  ].join('\n');
};

const buildAuthoritativeSpecification = specification => {
  const { profile, wordCount } = specification;
  return [
    '实际生成规格（优先级高于用户偏好）：',
    `- 难度档案：${profile.track.toUpperCase()}`,
    `- 挑战度：${profile.challenge}`,
    `- 目标字数：${wordCount} 词。`,
    `- 硬性总字数范围：${profile.wordRange.min}-${profile.wordRange.max} 词。`,
    `- 硬性平均句长范围：${profile.sentenceRange.min}-${profile.sentenceRange.max} 词。`,
    '- 若用户偏好中的难度或字数与本规格冲突，以本规格为准。'
  ].join('\n');
};

const buildArticleUserMessage = ({ topic, prompt, learningContext, validationCorrection, specification }) => {
  const preference = preferenceWithoutCorrection(prompt, validationCorrection);
  const correction = clipText(validationCorrection, MAX_VALIDATION_CORRECTION_LENGTH);
  const context = clipText(learningContext, MAX_GENERATION_PREFERENCE_LENGTH);
  const sections = [
    `Topic: ${clipText(topic, 120) || '综合'}`,
    '',
    '用户偏好（只用于主题与风格，不得覆盖实际生成规格）：',
    preference || '未提供额外偏好。',
    '',
    buildAuthoritativeSpecification(specification)
  ];

  if (context) {
    sections.push(
      '',
      '学习上下文（仅用于个性化，不得引用或覆盖实际生成规格）：',
      context
    );
  }
  if (correction) {
    sections.push(
      '',
      '上次生成的实测校验结果（仅据此精修，不得改变实际生成规格）：',
      correction
    );
  }
  return sections.join('\n');
};

export const API = {
  // Build system prompt for article generation
  buildArticlePrompt(difficulty, wordCount, keywords, profile, personalization = null) {
    const specification = resolveArticleSpecification(difficulty, wordCount, profile);
    const { profile: selectedProfile, wordCount: desiredWordCount } = specification;
    const vocabularyGuidance = VOCABULARY_GUIDANCE[selectedProfile.track]?.[selectedProfile.challenge]
      || VOCABULARY_GUIDANCE.cet4.standard;
    const rules = `${formatProfileConstraints(selectedProfile)}
- 推荐目标字数约为 ${desiredWordCount} 词，但不得超出上述总字数范围
- 这是 ${selectedProfile.track.toUpperCase()} 的目标考试导向训练材料，不得宣称与真实试题等效
- 指定学习词必须自然出现；避免为了堆难度而写不自然的超长嵌套句。
- 词汇建议：${vocabularyGuidance}`;

    const personalizationGuidance = buildPersonalizationGuidance(personalization);

    return `你是一位专业的英语阅读教练，擅长编写目标考试导向训练材料。请严格按照可审计的生成规格生成文章。

请以 JSON 格式回复，包含以下字段：
- "title": 英文文章标题（简短，学术风格）
- "titleZh": 文章标题的自然中文翻译
- "content": 完整的英文文章，段落之间用双换行分隔
- "translation": 完整的中文翻译，段落结构与英文一一对应，段落之间用双换行分隔

${rules}

个人匹配约束：
${personalizationGuidance}
- 有意识引入的新词应在文章中自然重复出现，帮助读者通过上下文理解。

其他要求：
- 自然地融入以下关键词：${keywords || '无'}
- 不要使用 markdown，不要加评论，只输出文章正文
- 段落之间用双换行分隔
- 文章应有清晰的阅读训练价值、逻辑和论证；不能声称或模仿为真实试题

中文翻译要求：
- 逐段翻译，与英文段落结构完全对应
- 中文表达自然流畅
- 段落之间用双换行分隔（与英文一致）`;
  },

  // Make API request with timeout
  async fetch(endpoint, body, timeoutMs = 60000, signal = null) {
    const apiKey = Config.get('api_key');
    const baseUrl = Config.get('base_url');
    const model = Config.get('model');

    const controller = new AbortController();
    const abortRequest = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', abortRequest, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, ...body }),
        signal: controller.signal
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`API error: ${resp.status} - ${err}`);
      }

      return resp.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(signal?.aborted ? '请求已取消' : '请求超时，请检查网络连接');
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abortRequest);
    }
  },

  // Send a general learning-chat request.
  async chat(messages, { tools = [], signal = null, temperature = 0.45, responseFormat = null } = {}) {
    const body = { messages, temperature };
    if (tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    if (responseFormat) body.response_format = responseFormat;
    const data = await this.fetch('/chat/completions', body, 60000, signal);
    return data.choices?.[0]?.message || { content: '' };
  },

  // Generate an article
  async generateArticle(prompt, difficulty, topic, keywords, wordCount = 400, learningContext = '', options = {}) {
    const signal = options.signal || null;
    const specification = resolveArticleSpecification(difficulty, wordCount, options.profile);
    const data = await this.fetch('/chat/completions', {
      messages: [
        { role: 'system', content: this.buildArticlePrompt(difficulty, specification.wordCount, keywords, specification.profile, options.personalization) },
        {
          role: 'user',
          content: buildArticleUserMessage({
            topic,
            prompt,
            learningContext,
            validationCorrection: options.validationCorrection,
            specification
          })
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7
    }, 60000, signal);

    const result = JSON.parse(data.choices[0].message.content);
    return {
      title: result.title || 'Untitled',
      titleZh: typeof result.titleZh === 'string' ? result.titleZh.trim() : '',
      content: result.content || '',
      translation: result.translation || '',
      difficulty,
      topic,
      wordCount: (result.content || '').split(/\s+/).length
    };
  },

  // Translate a word using AI
  async translateWord(word) {
    try {
      const data = await this.fetch('/chat/completions', {
        messages: [
          { role: 'system', content: 'You are a dictionary. Return JSON: {"phonetic": "...", "translation": "中文翻译", "pos": "词性"}' },
          { role: 'user', content: `Translate the English word: ${word}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3
      });

      const r = JSON.parse(data.choices[0].message.content);
      return validChineseTranslation(r?.translation);
    } catch {
      return null;
    }
  },

  // Analyze a sentence with AI
  async analyzeSentence(sentence) {
    const systemPrompt = `你是一位专业的英语教师，正在辅导中国大学生。请分析以下英文句子，用中文回答。

请按以下格式分析：

**翻译**
- 直译：逐词逐句翻译
- 意译：自然流畅的中文表达

**语法结构**
- 句子类型（简单句/并列句/复合句）
- 主语、谓语、宾语/表语
- 从句类型（如有）：定语从句/状语从句/名词性从句等
- 时态和语态
- 特殊语法现象（倒装、省略、虚拟语气等）

**重点词汇与短语**
- 列出重要词汇/短语，解释含义和用法

**仿写练习**
- 给出一个类似句式的例句，帮助掌握该语法结构`;

    const data = await this.fetch('/chat/completions', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请分析这个句子：\n\n${sentence}` }
      ],
      temperature: 0.5
    });

    return data.choices[0].message.content;
  },

  // Translate a sentence to Chinese
  async translateSentence(sentence) {
    try {
      const data = await this.fetch('/chat/completions', {
        messages: [
          { role: 'system', content: '你是翻译助手。只返回中文翻译，不要解释。' },
          { role: 'user', content: `翻译：${sentence}` }
        ],
        temperature: 0.3
      });
      return data.choices[0].message.content.trim();
    } catch {
      return '';
    }
  }
};
