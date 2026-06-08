import { Config } from "./config.js";
/**
 * API Module
 * Handles all AI API calls (DeepSeek)
 */

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
  buildArticlePrompt(difficulty, wordCount, keywords) {
    const level = Config.get('level') || 'easy';
    const key = `${difficulty}_${level}`;
    const rules = (this.difficultyRules[key] || this.difficultyRules['cet4_easy']) +
      `\n- 总字数控制在 ${wordCount} 词左右`;

    // Get coverage settings
    const coverage = Config.get('coverage') || '95';
    const newWordPercent = Config.get('new_word_percent') || '5';

    return `你是一位专业的英语考试辅导教师，擅长编写符合真实考试标准的阅读材料。请严格按照难度要求生成文章。

请以 JSON 格式回复，包含以下字段：
- "title": 英文文章标题（简短，学术风格）
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
  async fetch(endpoint, body, timeoutMs = 60000) {
    const apiKey = Config.get('api_key');
    const baseUrl = Config.get('base_url');
    const model = Config.get('model');

    const controller = new AbortController();
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
        throw new Error('请求超时，请检查网络连接');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },

  // Generate an article
  async generateArticle(prompt, difficulty, topic, keywords, wordCount = 400) {
    const data = await this.fetch('/chat/completions', {
      messages: [
        { role: 'system', content: this.buildArticlePrompt(difficulty, wordCount, keywords) },
        { role: 'user', content: `Topic: ${topic}\n\nUser request: ${prompt}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7
    });

    const result = JSON.parse(data.choices[0].message.content);
    return {
      title: result.title || 'Untitled',
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
  }
};
