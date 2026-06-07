/**
 * Affixes Module
 * AI-powered word root analysis with memory tips
 * Auto-analyzes when word is saved to favorites
 */

const Affixes = {
  // Get word analysis (cache-first, then AI)
  async getAnalysis(word) {
    const key = word.toLowerCase();
    const cacheKey = `root_v2_${key}`;

    // Check cache first
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {}

    // Generate with AI
    return await this.analyzeWithAI(key);
  },

  // AI-powered deep analysis
  async analyzeWithAI(word) {
    const prompt = `分析英文单词 "${word}"，返回JSON格式：
{
  "breakdown": "un-(否定) + happy(快乐) + -ness(名词化)",
  "origin": "古英语",
  "memoryTip": "联想记忆或词根故事，帮助记忆这个单词",
  "relatedWords": ["unhappy", "happiness", "happily"]
}

要求：
1. breakdown 要详细拆解每个部分（前缀+词根+后缀），标注含义
2. origin 说明词源（拉丁语/希腊语/古英语/法语等）
3. memoryTip 给一个实用的记忆方法（联想/谐音/词根故事/场景记忆）
4. relatedWords 列出3-5个同根词
5. 如果没有明显词根结构，breakdown 写词源分析，memoryTip 给联想记忆`;

    try {
      const data = await API.fetch('/chat/completions', {
        messages: [
          { role: 'system', content: '你是英语词源学专家和记忆方法专家。只返回JSON，不要解释。' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5
      });

      const result = JSON.parse(data.choices[0].message.content);

      // Cache permanently
      const cacheKey = `root_v2_${word.toLowerCase()}`;
      try {
        localStorage.setItem(cacheKey, JSON.stringify(result));
      } catch {}

      return result;
    } catch {
      return null;
    }
  },

  // Pre-analyze a word in background (called when saving to favorites)
  async preAnalyze(word) {
    const key = word.toLowerCase();
    const cacheKey = `root_v2_${key}`;

    // Skip if already cached
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return;
    } catch {}

    // Analyze in background (don't await, don't block)
    this.analyzeWithAI(key).catch(() => {});
  }
};
