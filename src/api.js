/**
 * API Module
 * Handles all AI API calls (DeepSeek)
 */

import { Config } from './config.js';
import { formatProfileConstraints, getDifficultyProfile } from './difficulty-profile.mjs';

const VOCABULARY_GUIDANCE = {
  cet4: {
    support: '优先使用高频词汇和基础学术词，避免堆砌生僻词。',
    standard: '以四级核心词汇为主，适度使用常见学术词和抽象表达。',
    stretch: '以四级核心词汇为主，可加入适量进阶学术词，但保持语义自然。'
  },
  cet6: {
    support: '以高频四、六级词汇为主，适度使用常见学术词。',
    standard: '使用六级核心词汇和常见学术词，保持语篇清晰。',
    stretch: '使用六级核心词汇和适量进阶学术词，避免为难度而堆词。'
  },
  graduate: {
    support: '使用考研常见词汇和社科学术表达，优先保证可读性。',
    standard: '使用考研词汇和常见学术表达，保持论证自然完整。',
    stretch: '使用考研词汇和适量进阶学术表达，避免不自然的术语堆砌。'
  }
};

const MAX_GENERATION_PREFERENCE_LENGTH = 2400;
const MAX_VALIDATION_CORRECTION_LENGTH = 1800;

const clipText = (value, limit) => String(value || '').trim().slice(0, limit);

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
  // 6-level difficulty rules (difficulty + level combination)
  difficultyRules: {
    'cet4_easy': `四级（易）难度要求：

【词汇】
- 使用高频3000词汇，避免生僻词
- 基础学术词：important, result, problem, develop, increase, change

【句式】
- 以简单句和并列句为主，每句12-18个单词
- 少量定语从句（that/which引导）
- 避免复杂嵌套结构

【文章结构】
- 250-300词，3-4个段落
- 线性叙述结构，主题句明确
- 基础连接词：and, but, so, because, first, second`,

    'cet4_hard': `四级（难）难度要求：

【词汇】
- 使用四级大纲词汇（约4500词），包含学术词汇
- 学术词：significant, demonstrate, phenomenon, consequently, approximately, perspective, implication

【句式】
- 复合句为主，每句18-25个单词
- 包含定语从句、状语从句、宾语从句
- 适当使用被动语态、形式主语（It is...that...）

【文章结构】
- 300-400词，4-5个段落
- 议论文结构：提出观点→举例论证→得出结论
- 连接词：however, furthermore, therefore, in contrast, nevertheless`,

    'cet6_easy': `六级（易）难度要求：

【词汇】
- 使用5000词汇量，包含四级词汇+部分六级词汇
- 学术词：analyze, evaluate, significant, potential, fundamental

【句式】
- 复合句为主，少量嵌套，每句20-28个单词
- 可使用定语从句、状语从句
- 适当使用被动语态

【文章结构】
- 350-400词，4-5个段落
- 多角度论述，有数据或案例引用
- 连接词：moreover, however, therefore, similarly`,

    'cet6_hard': `六级（难）难度要求：

【词汇】
- 使用六级大纲词汇（约6000词），包含专业术语
- 高级词：notwithstanding, paradigm, empirical, hypothetical, proliferation, exacerbate, ubiquitous

【句式】
- 长难句为主，每句25-35个单词
- 多层从句嵌套（定语+状语+名词性从句）
- 使用倒装句、省略句、独立主格

【文章结构】
- 400-500词，5-6个段落
- 学术论证结构：背景→论点→多角度论证→总结
- 高级连接词：conversely, inasmuch as, presuppose`,

    'graduate_easy': `考研（易）难度要求：

【词汇】
- 考研大纲词汇（约5500词），包含学术词汇
- 核心词：significant, demonstrate, implication, perspective, substantial

【句式】
- 长难句为主，含同位语、插入语，每句22-30个单词
- 定语从句+状语从句组合
- 适当使用被动语态和形式主语

【文章结构】
- 350-400词，4-5个段落
- 社科类议论文结构
- 逻辑连接词：however, therefore, moreover, nevertheless`,

    'graduate_hard': `考研（难）难度要求：

【词汇】
- 考研大纲词汇+学术高频词+熟词僻义
- 熟词僻义：address(处理), sound(合理的), yield(产出), figure(认为), coin(创造)
- 高级词：albeit, whereby, therein, thereof, notwithstanding, insofar as

【句式】
- 复杂长难句，每句30-40个单词
- 多重嵌套：主句+定语从句+状语从句+同位语从句
- 插入语、破折号补充说明
- 倒装、省略、虚拟语气、强调句型

【文章结构】
- 400-500词，5-7个段落
- 学术论文风格：提出问题→分析论证→辩证思考→提出建议
- 严密逻辑链条：因果、转折、递进、让步
- 观点客观中立，避免绝对化表述`
  },

  // Build system prompt for article generation
  buildArticlePrompt(difficulty, wordCount, keywords, profile) {
    const specification = resolveArticleSpecification(difficulty, wordCount, profile);
    const { profile: selectedProfile, wordCount: desiredWordCount } = specification;
    const vocabularyGuidance = VOCABULARY_GUIDANCE[selectedProfile.track][selectedProfile.challenge];
    const rules = `${formatProfileConstraints(selectedProfile)}
- 推荐目标字数约为 ${desiredWordCount} 词，但不得超出上述总字数范围
- 这是 ${selectedProfile.track.toUpperCase()} 导向练习，不得宣称与真实试题等效
- 指定学习词必须自然出现；避免为了堆难度而写不自然的超长嵌套句。
- 词汇建议：${vocabularyGuidance}`;

    // Get coverage settings
    const coverage = Config.get('coverage') || '95';
    const newWordPercent = Config.get('new_word_percent') || '5';

    return `你是一位专业的英语考试辅导教师，擅长编写符合真实考试标准的阅读材料。请严格按照难度要求生成文章。

请以 JSON 格式回复，包含以下字段：
- "title": 英文文章标题（简短，学术风格）
- "titleZh": 文章标题的自然中文翻译
- "content": 完整的英文文章，段落之间用双换行分隔
- "translation": 完整的中文翻译，段落结构与英文一一对应，段落之间用双换行分隔

${rules}

生词比例控制：
- 文章中约 ${coverage}% 的词汇应为常见高频词汇（读者大概率认识的词）
- 新词（较难/生僻词）控制在约 ${newWordPercent}% 左右
- 新词应在文章中自然重复出现 2-3 次，帮助读者通过上下文理解

其他要求：
- 自然地融入以下关键词：${keywords || '无'}
- 不要使用 markdown，不要加评论，只输出文章正文
- 段落之间用双换行分隔
- 文章要像真实的考试阅读材料，有深度、有逻辑、有论证

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
  async chat(messages, { tools = [], signal = null, temperature = 0.45 } = {}) {
    const body = { messages, temperature };
    if (tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    const data = await this.fetch('/chat/completions', body, 60000, signal);
    return data.choices?.[0]?.message || { content: '' };
  },

  // Generate an article
  async generateArticle(prompt, difficulty, topic, keywords, wordCount = 400, learningContext = '', options = {}) {
    const signal = options.signal || null;
    const specification = resolveArticleSpecification(difficulty, wordCount, options.profile);
    const data = await this.fetch('/chat/completions', {
      messages: [
        { role: 'system', content: this.buildArticlePrompt(difficulty, specification.wordCount, keywords, specification.profile) },
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
      return r.translation || word;
    } catch {
      return word;
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
