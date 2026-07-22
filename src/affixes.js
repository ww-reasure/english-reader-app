/**
 * Affixes Module
 * AI-powered word root analysis with memory tips
 * Auto-analyzes when word is saved to favorites
 */

import { API } from './api.js';
import { Dictionary } from './dictionary.js';

export const Affixes = {
  // Get word analysis (cache-first, then AI)
  async getAnalysis(word) {
    const key = word.toLowerCase();
    const cacheKey = `root_v2_${key}`;

    // Check cache first
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const analysis = this.normalizeAnalysis(JSON.parse(cached));
        this.saveAnalysis(key, analysis);
        return analysis;
      }
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
  "relatedWords": [
    { "word": "unhappy", "translation": "不快乐的" },
    { "word": "happiness", "translation": "幸福；快乐" }
  ]
}

要求：
1. breakdown 要详细拆解每个部分（前缀+词根+后缀），标注含义
2. origin 说明词源（拉丁语/希腊语/古英语/法语等）
3. memoryTip 给一个实用的记忆方法（联想/谐音/词根故事/场景记忆）
4. relatedWords 列出3-5个同根词；每项必须包含英文 word 与简洁准确的中文 translation
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

      const result = this.normalizeAnalysis(JSON.parse(data.choices[0].message.content));
      this.saveAnalysis(word, result);
      return result;
    } catch {
      return null;
    }
  },

  normalizeAnalysis(analysis) {
    if (!analysis || typeof analysis !== 'object') return analysis;
    const relatedTranslations = { ...(analysis.relatedTranslations || {}) };
    const relatedWords = [];
    for (const related of Array.isArray(analysis.relatedWords) ? analysis.relatedWords : []) {
      const word = typeof related === 'string' ? related : related?.word;
      const translation = typeof related === 'object' ? related.translation : relatedTranslations[word];
      const key = typeof word === 'string' ? word.trim().toLowerCase() : '';
      if (!key || relatedWords.includes(key)) continue;
      relatedWords.push(key);
      if (typeof translation === 'string' && translation.trim()) relatedTranslations[key] = translation.trim();
    }
    return { ...analysis, relatedWords, relatedTranslations };
  },

  getRelatedWordDetails(analysis) {
    const normalized = this.normalizeAnalysis(analysis) || {};
    return (normalized.relatedWords || []).map(word => ({
      word,
      translation: normalized.relatedTranslations?.[word] || ''
    }));
  },

  saveAnalysis(word, analysis) {
    if (!analysis) return;
    try {
      localStorage.setItem(`root_v2_${word.toLowerCase()}`, JSON.stringify(analysis));
    } catch {}
  },

  async enrichRelatedTranslations(word, analysis) {
    const normalized = this.normalizeAnalysis(analysis);
    if (!normalized) return null;
    const missing = this.getRelatedWordDetails(normalized).filter(item => !item.translation);
    if (!missing.length) return normalized;

    const updates = await Promise.all(missing.map(async ({ word: relatedWord }) => {
      try {
        const dictionaryResult = await Dictionary.lookup(relatedWord);
        const dictionaryTranslation = dictionaryResult?.translation?.trim() || '';
        if (/[㐀-鿿]/.test(dictionaryTranslation)) return [relatedWord, dictionaryTranslation];
        const translated = (await API.translateWord(relatedWord))?.trim() || '';
        return [relatedWord, /[㐀-鿿]/.test(translated) ? translated : ''];
      } catch {
        return [relatedWord, ''];
      }
    }));

    const relatedTranslations = { ...(normalized.relatedTranslations || {}) };
    for (const [relatedWord, translation] of updates) {
      if (translation) relatedTranslations[relatedWord] = translation;
    }
    const enriched = { ...normalized, relatedTranslations };
    this.saveAnalysis(word, enriched);
    return enriched;
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
