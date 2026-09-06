export const PREPARE_WORD_IMPORT_TOOL = {
  type: 'function',
  function: {
    name: 'prepare_word_import',
    description: '把一组单词整理成“加入单词库”的导入计划并展示确认卡片，用户在聊天里点“确认导入”后才会写入词库。当用户想收藏、整理或批量加入单词时调用。不要声称单词已经写入词库；写入结果以确认卡的完成状态为准。',
    parameters: {
      type: 'object',
      properties: {
        words: { type: 'string', description: '要加入词库的英文单词，逗号、空格或换行分隔，一次最多 200 个' }
      },
      required: ['words']
    }
  }
};

export class WordImportPlanTool {
  constructor({ service, now = () => Date.now() } = {}) {
    this.service = service;
    this.now = typeof now === 'function' ? now : () => Date.now();
  }

  async execute(args = {}) {
    const wordsText = String(args.words || '');
    if (!wordsText.trim()) {
      return { result: { status: 'empty_words', message: '请提供要加入词库的单词。' } };
    }
    const plan = await this.service.createPlan(wordsText, { source: 'chat' });
    if (plan.limitExceeded || plan.truncated) {
      return {
        result: { status: 'too_many_words', wordLimit: plan.wordLimit, message: '单词太多，请分批导入。' }
      };
    }
    if (!plan.counts?.recognized) {
      return { result: { status: 'no_valid_words', message: '没有识别出可加入词库的英文单词。' } };
    }
    return {
      result: { status: 'plan_ready', counts: plan.counts, words: plan.words },
      artifact: {
        type: 'word_import_plan',
        wordsText,
        words: plan.words,
        counts: plan.counts,
        categories: plan.categories,
        createdAt: this.now()
      }
    };
  }
}
