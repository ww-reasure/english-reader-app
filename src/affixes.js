/**
 * Affixes Module
 * AI-powered word root analysis with memory tips
 * Auto-analyzes when word is saved to favorites
 */

import { API } from './api.js';
import { Dictionary } from './dictionary.js';
import { normalizeRelatedRootWord, normalizeRootFamily } from './components/affix-root-family.mjs';

export const Affixes = {
  structuredRootRequests: new Map(),

  // Get word analysis (cache-first, then AI)
  async getAnalysis(word) {
    const key = word.toLowerCase();
    const cacheKey = `root_v3_${key}`;

    // Check cache first
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        return this.normalizeAnalysis(JSON.parse(cached));
      }
      const legacy = localStorage.getItem(`root_v2_${key}`);
      if (legacy) return this.normalizeAnalysis(JSON.parse(legacy));
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
  "rootFamily": {
    "label": "happy",
    "meaningZh": "快乐",
    "forms": ["happy", "happi"]
  },
  "relatedWords": [
    { "word": "unhappy", "translation": "不快乐的", "rootForm": "happy" },
    { "word": "happiness", "translation": "幸福；快乐", "rootForm": "happi" }
  ]
}

要求：
1. breakdown 要详细拆解每个部分（前缀+词根+后缀），标注含义
2. origin 说明词源（拉丁语/希腊语/古英语/法语等）
3. memoryTip 给一个实用的记忆方法（联想/谐音/词根故事/场景记忆）
4. rootFamily 只填写共同词根或词干；forms 填写实际可能出现在各单词中的拼写变体
5. relatedWords 列出3-5个同根词；每项必须包含英文 word、简洁准确的中文 translation 和对应的 rootForm
6. 如果没有明显词根结构，breakdown 写词源分析，rootFamily 与 rootForm 置空，memoryTip 给联想记忆`;

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
    const rootFamily = normalizeRootFamily(analysis.rootFamily);
    const relatedTranslations = { ...(analysis.relatedTranslations || {}) };
    const relatedRootForms = { ...(analysis.relatedRootForms || {}) };
    const relatedWords = [];
    for (const related of Array.isArray(analysis.relatedWords) ? analysis.relatedWords : []) {
      const word = typeof related === 'string' ? related : related?.word;
      const translation = typeof related === 'object' ? related.translation : relatedTranslations[word];
      const key = typeof word === 'string' ? word.trim().toLowerCase() : '';
      if (!key || relatedWords.includes(key)) continue;
      relatedWords.push(key);
      if (typeof translation === 'string' && translation.trim()) relatedTranslations[key] = translation.trim();
      const normalized = normalizeRelatedRootWord({ word: key, translation, rootForm: typeof related === 'object' ? related.rootForm : relatedRootForms[key] }, rootFamily);
      if (normalized?.rootForm) relatedRootForms[key] = normalized.rootForm;
    }
    return {
      ...analysis,
      schemaVersion: rootFamily ? 3 : Number(analysis.schemaVersion || 2),
      rootFamily,
      relatedWords,
      relatedTranslations,
      relatedRootForms
    };
  },

  getRelatedWordDetails(analysis) {
    const normalized = this.normalizeAnalysis(analysis) || {};
    return (normalized.relatedWords || []).map(word => ({
      word,
      translation: normalized.relatedTranslations?.[word] || '',
      rootForm: normalized.relatedRootForms?.[word] || ''
    }));
  },

  saveAnalysis(word, analysis) {
    if (!analysis) return;
    try {
      localStorage.setItem(`root_v3_${word.toLowerCase()}`, JSON.stringify(this.normalizeAnalysis(analysis)));
    } catch {}
  },

  hasStructuredRoot(analysis) {
    const family = normalizeRootFamily(analysis?.rootFamily);
    return Boolean(family?.forms?.length);
  },

  async ensureStructuredRoot(word, analysis, { signal } = {}) {
    const key = String(word || '').trim().toLowerCase();
    const normalized = this.normalizeAnalysis(analysis);
    if (!key || !normalized || this.hasStructuredRoot(normalized)) return normalized;

    const cached = await this.getAnalysis(key).catch(() => normalized);
    if (this.hasStructuredRoot(cached)) return cached;
    if (this.structuredRootRequests.has(key)) return this.structuredRootRequests.get(key);

    const request = (async () => {
      const related = this.getRelatedWordDetails(normalized).map(item => ({ word: item.word, translation: item.translation }));
      const prompt = `为英文单词 "${key}" 的同根词资料补齐共同词根信息。只返回 JSON：\n{
  "rootFamily": { "label": "duc / duct", "meaningZh": "引导；带领", "forms": ["duc", "duct"] },
  "relatedWords": [
    { "word": "produce", "translation": "生产；制造", "rootForm": "duc" }
  ]
}\n已有拆解：${normalized.breakdown || '无'}\n已有同根词：${JSON.stringify(related)}\n要求：只使用已有同根词；每个 rootForm 必须是该英文词中连续出现的 forms 成员；无法可靠确定时 rootFamily 置空。`;
      const data = await API.fetch('/chat/completions', {
        messages: [
          { role: 'system', content: '你是英语词源学专家。只返回合法 JSON，不猜测词根。' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      }, 60000, signal || null);
      const enriched = this.normalizeAnalysis({
        ...normalized,
        ...JSON.parse(data.choices?.[0]?.message?.content || '{}')
      });
      if (!this.hasStructuredRoot(enriched)) return normalized;
      this.saveAnalysis(key, enriched);
      return enriched;
    })();

    this.structuredRootRequests.set(key, request);
    try {
      return await request;
    } finally {
      if (this.structuredRootRequests.get(key) === request) this.structuredRootRequests.delete(key);
    }
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
    const cacheKey = `root_v3_${key}`;

    // Skip if already cached
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached || localStorage.getItem(`root_v2_${key}`)) return;
    } catch {}

    // Analyze in background (don't await, don't block)
    this.analyzeWithAI(key).catch(() => {});
  }
};
