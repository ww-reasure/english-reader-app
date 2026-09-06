import { contentFingerprint, prepareImportedArticle } from './article-import.mjs';

const IMPORT_DIFFICULTIES = ['cet4', 'cet6', 'kaoyan1', 'kaoyan2', 'graduate'];

export const SAVE_READING_CARD_TOOL = {
  type: 'function',
  function: {
    name: 'save_reading_card',
    description: '把用户提供的完整英文文章保存为书库里可点击阅读的阅读卡片。当用户粘贴文章、拍摄文章页面并希望保存阅读，或明确要求把某篇文章转成阅读卡片/收进书架时调用。content 必须是文章完整原文，不得摘要、缩写或原创改写。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '文章标题；用户没有给标题时根据内容拟一个简短标题' },
        content: { type: 'string', description: '文章完整英文原文（3-50000 个英文单词），保持原文，不要总结' },
        translation: { type: 'string', description: '可选的中文对照翻译，与原文段落对应；没有就省略' },
        difficulty: { type: 'string', enum: IMPORT_DIFFICULTIES, description: '难度标签；省略时按用户当前考试档位' }
      },
      required: ['title', 'content']
    }
  }
};

export class ArticleImportTool {
  constructor({ db, resolveDifficulty = () => 'cet4' } = {}) {
    this.db = db;
    this.resolveDifficulty = typeof resolveDifficulty === 'function' ? resolveDifficulty : () => 'cet4';
  }

  async execute(args = {}) {
    let article;
    try {
      article = prepareImportedArticle({
        title: String(args.title || ''),
        content: String(args.content || ''),
        translation: String(args.translation || ''),
        difficulty: args.difficulty || this.resolveDifficulty(),
        fileName: ''
      });
    } catch (error) {
      return {
        result: {
          status: 'invalid_content',
          message: String(error?.message || '文章内容无效。需要 3-50000 个英文单词的正文，请让用户补充完整原文。')
        }
      };
    }
    const existing = typeof this.db.getAllArticles === 'function' ? await this.db.getAllArticles() : [];
    const duplicate = existing.find(item => item?.contentFingerprint === article.contentFingerprint
      || contentFingerprint(item?.content || '') === article.contentFingerprint);
    if (duplicate) {
      return {
        result: { status: 'duplicate', articleId: duplicate.id, title: duplicate.title },
        artifact: { type: 'article', source: 'import', importStatus: 'duplicate', article: duplicate }
      };
    }
    const id = await this.db.saveArticle(article);
    return {
      result: { status: 'saved', articleId: id, title: article.title, wordCount: article.wordCount },
      artifact: { type: 'article', source: 'import', importStatus: 'saved', article: { ...article, id } }
    };
  }
}
