const DIFFICULTIES = new Set(['cet4', 'cet6', 'graduate']);

const clip = (value, limit) => String(value || '').trim().slice(0, limit);
const cancelled = () => new Error('请求已取消');

const assertActive = ({ signal, isActive }) => {
  if (signal?.aborted || !isActive()) throw cancelled();
};

export const GENERATE_READING_TOOL = {
  type: 'function',
  function: {
    name: 'generate_reading',
    description: '为用户生成并保存一篇可点击阅读的英语学习文章。仅在用户明确要求定制阅读、练习文章或基于学习情况出一篇阅读时调用，不要在聊天正文中直接写完整文章。',
    parameters: {
      type: 'object',
      properties: {
        request: { type: 'string', description: '用户的阅读生成要求' },
        topic: { type: 'string', description: '文章主题，可省略' },
        difficulty: { type: 'string', enum: ['cet4', 'cet6', 'graduate'], description: '四级、六级或考研' },
        wordCount: { type: 'integer', minimum: 250, maximum: 600, description: '建议篇幅' }
      },
      required: ['request']
    }
  }
};

export class ArticleGenerationTool {
  constructor({ api, db, pickWords = words => words.slice(0, 8), now = () => Date.now() }) {
    this.api = api;
    this.db = db;
    this.pickWords = pickWords;
    this.now = now;
  }

  async execute(args = {}, options = {}) {
    const fallbackDifficulty = DIFFICULTIES.has(options.fallbackDifficulty) ? options.fallbackDifficulty : 'cet4';
    const difficulty = DIFFICULTIES.has(args.difficulty) ? args.difficulty : fallbackDifficulty;
    const topic = clip(args.topic, 80) || clip(options.fallbackTopic, 80) || '综合';
    const wordCount = Math.max(250, Math.min(600, Number.parseInt(args.wordCount, 10) || 400));
    const request = clip(args.request || args.prompt, 1200) || `请生成一篇${difficulty}难度的英语阅读文章。`;
    const isActive = typeof options.isActive === 'function' ? options.isActive : () => true;

    assertActive({ signal: options.signal, isActive });
    const learnWords = await this.db.getAllLearnWords();
    assertActive({ signal: options.signal, isActive });
    const keywords = this.pickWords(learnWords).map(word => word.word).filter(Boolean).join(', ');
    const article = await this.api.generateArticle(request, difficulty, topic, keywords, wordCount, options.learningContext || '', { signal: options.signal });
    assertActive({ signal: options.signal, isActive });

    const articleToSave = { ...article, difficulty, topic, createdAt: this.now() };
    const id = await this.db.saveArticle(articleToSave);
    if (options.signal?.aborted || !isActive()) {
      await this.db.deleteArticle?.(id);
      throw cancelled();
    }

    const savedArticle = { ...articleToSave, id };
    return {
      article: savedArticle,
      metadata: { id, title: savedArticle.title, difficulty, wordCount: savedArticle.wordCount || 0 },
      keywords
    };
  }
}
