import { AiCache } from '../components/ai-cache.mjs';

export const PARAGRAPH_TRANSLATION_CACHE_NAMESPACE = 'exam-paragraph-translation';
export const PARAGRAPH_TRANSLATION_CACHE_VERSION = 'exam-paragraph-translation-v1';

const HAN = /[\u3400-\u9fff]/u;

function normalize(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of normalize(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createParagraphTranslationCacheKey({
  examId = '',
  bankId = '',
  packageId = '',
  paperKey = '',
  unitKey = '',
  paragraphKey = '',
  text = ''
} = {}) {
  return JSON.stringify({
    examId: normalize(examId),
    bankId: normalize(bankId),
    packageId: normalize(packageId),
    paperKey: normalize(paperKey),
    unitKey: normalize(unitKey),
    paragraphKey: normalize(paragraphKey),
    sourceVersion: 1,
    textHash: hashText(text)
  });
}

async function defaultTranslate(text) {
  const { API } = await import('../api.js');
  return API.translateSentence(text);
}

export function createParagraphTranslationService({ cache = AiCache, translate = defaultTranslate } = {}) {
  if (!cache?.getOrCreate) throw new TypeError('Paragraph translation requires an AiCache-compatible cache');
  if (typeof translate !== 'function') throw new TypeError('Paragraph translation requires a translate function');
  return Object.freeze({
    async getOrTranslate({ context = {}, text = '', existingTranslation = '' } = {}) {
      const stored = normalize(existingTranslation);
      if (stored) return { text: stored, source: 'pack' };
      const sourceText = normalize(text);
      if (!sourceText) throw new Error('段落原文为空，无法翻译');
      const key = createParagraphTranslationCacheKey({ ...context, text: sourceText });
      const translated = await cache.getOrCreate(
        PARAGRAPH_TRANSLATION_CACHE_NAMESPACE,
        key,
        async () => {
          const candidate = normalize(await translate(sourceText));
          if (!candidate || !HAN.test(candidate)) throw new Error('AI 未返回有效中文翻译');
          return candidate;
        },
        { version: PARAGRAPH_TRANSLATION_CACHE_VERSION }
      );
      return { text: normalize(translated), source: 'ai' };
    }
  });
}

export const paragraphTranslationService = createParagraphTranslationService();
