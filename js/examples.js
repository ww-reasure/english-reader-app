/**
 * Examples Module
 * AI-powered example sentences with caching
 * Auto-generates when word is saved to favorites
 */

const Examples = {
  // Get examples for a word (cache-first, then AI)
  async getExamples(word) {
    const key = word.toLowerCase();
    const cacheKey = `examples_${key}`;

    // Check cache
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {}

    // Generate with AI
    return await this.generateWithAI(key);
  },

  // Generate examples with AI
  async generateWithAI(word) {
    const prompt = `为英文单词 "${word}" 生成3个不同场景的简短例句。返回JSON：
{
  "examples": [
    "日常场景的例句（10-15词）",
    "学术/工作场景的例句（10-15词）",
    "情感/文学场景的例句（10-15词）"
  ]
}

要求：
1. 每句10-15个单词，简洁明了
2. 突出该单词的典型用法
3. 场景差异要大，帮助理解不同语境`;

    try {
      const data = await API.fetch('/chat/completions', {
        messages: [
          { role: 'system', content: '只返回JSON，不要解释。' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5
      });

      const result = JSON.parse(data.choices[0].message.content);
      const examples = result.examples || [];

      // Cache permanently
      if (examples.length > 0) {
        try {
          localStorage.setItem(`examples_${word.toLowerCase()}`, JSON.stringify(examples));
        } catch {}
      }

      return examples;
    } catch {
      return [];
    }
  },

  // Pre-generate examples in background (called when saving to favorites)
  preGenerate(word) {
    const key = word.toLowerCase();
    const cacheKey = `examples_${key}`;

    // Skip if already cached
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return;
    } catch {}

    // Generate in background
    this.generateWithAI(key).catch(() => {});
  }
};
