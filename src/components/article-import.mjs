const ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g;
const BLOCK_TAG_PATTERN = /<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/giu;

const text = value => String(value ?? '');

function detectFormat(name = '', mime = '') {
  const lowerName = text(name).trim().toLocaleLowerCase('en-US');
  if (/\.markdown?$/.test(lowerName)) return 'markdown';
  if (/\.html?$/.test(lowerName)) return 'html';
  const lowerMime = text(mime).toLocaleLowerCase('en-US');
  if (lowerMime.includes('html')) return 'html';
  if (lowerMime.includes('markdown')) return 'markdown';
  return 'text';
}

function decodeHtmlEntities(value) {
  return text(value)
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_match, code) => {
      const number = Number(code);
      return Number.isFinite(number) ? String.fromCodePoint(Math.min(0x10ffff, number)) : '';
    })
    .replace(/&#x([\da-f]+);/giu, (_match, code) => {
      const number = Number.parseInt(code, 16);
      return Number.isFinite(number) ? String.fromCodePoint(Math.min(0x10ffff, number)) : '';
    });
}

function stripHtml(value) {
  return decodeHtmlEntities(text(value)
    .replace(/<\s*(?:script|style|noscript|template)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style|noscript|template)\s*>/giu, '')
    .replace(BLOCK_TAG_PATTERN, match => /<\s*\/|<\s*br|<\s*hr/iu.test(match) ? '\n' : '\n')
    .replace(/<[^>]*>/gu, ' '));
}

function stripMarkdown(value) {
  return text(value)
    .replace(/^\s*```[^\n]*$/gmu, '')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/^\s{0,3}>\s?/gmu, '')
    .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/gmu, '')
    .replace(/^\s*(?:---+|___+|\*\*\*+)\s*$/gmu, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/(\*\*|__)(.*?)\1/gu, '$2')
    .replace(/([*_~])(.*?)\1/gu, '$2');
}

function normalizeLines(value) {
  return text(value)
    .replace(/\r\n?/gu, '\n')
    .replace(/\u00a0/gu, ' ')
    .replace(/[\u201c\u201d]/gu, '"')
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(ZERO_WIDTH_PATTERN, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
    .split('\n')
    .map(line => line.replace(/[ \t]+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .trim();
}

export function normalizeImportedContent(value, options = {}) {
  const format = typeof options === 'string' ? options : options?.format || 'text';
  let source = text(value).replace(/^\uFEFF/u, '');
  if (format === 'html') source = stripHtml(source);
  else if (format === 'markdown' || format === 'md') source = stripMarkdown(source);
  if (format !== 'html') source = source.replace(/<\s*(?:script|style|noscript|template)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style|noscript|template)\s*>/giu, '');
  return normalizeLines(decodeHtmlEntities(source));
}

export const cleanImportedContent = normalizeImportedContent;
export const sanitizeImportedContent = normalizeImportedContent;
export const normalizeArticleContent = normalizeImportedContent;

export function countEnglishWords(value) {
  return (text(value).match(ENGLISH_WORD_PATTERN) || []).length;
}

export function validateImportedContent(value, { minWords = 3, maxWords = 50000 } = {}) {
  const content = text(value).trim();
  const wordCount = countEnglishWords(content);
  const errors = [];
  if (!content) errors.push({ code: 'empty', message: '请输入英文正文' });
  if (!/[A-Za-z]/u.test(content)) errors.push({ code: 'not-english', message: '正文需要包含英文内容' });
  if (wordCount < minWords) errors.push({ code: 'too-short', message: `正文至少需要 ${minWords} 个英文单词` });
  if (wordCount > maxWords) errors.push({ code: 'too-long', message: `正文不能超过 ${maxWords} 个英文单词` });
  return {
    valid: errors.length === 0,
    ok: errors.length === 0,
    content,
    wordCount,
    errors,
    message: errors.map(error => error.message).join('；')
  };
}

export const validateImportedArticle = validateImportedContent;

export function contentFingerprint(value) {
  return normalizeImportedContent(value)
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ')
    .trim();
}

export const duplicateKeyForContent = contentFingerprint;
export const getContentFingerprint = contentFingerprint;

export function titleFromFileName(fileName) {
  const raw = text(fileName).trim().split(/[\\/]/u).pop() || '';
  const withoutExtension = raw.replace(/\.(?:txt|md|markdown|html|htm)$/iu, '');
  return withoutExtension.replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').trim() || '未命名文章';
}

export const titleFromFilename = titleFromFileName;

export async function parseImportedDocument(file) {
  if (!file || typeof file.text !== 'function') throw new TypeError('无法读取导入文件');
  const name = text(file.name || '');
  const format = detectFormat(name, file.type);
  const content = normalizeImportedContent(await file.text(), { format });
  const validation = validateImportedContent(content);
  if (!validation.valid) {
    const error = new Error(validation.message || '导入内容无效');
    error.code = 'INVALID_IMPORT_CONTENT';
    error.validation = validation;
    throw error;
  }
  return {
    title: titleFromFileName(name),
    content,
    format,
    sourceType: 'imported',
    source: 'local',
    fileName: name,
    wordCount: validation.wordCount
  };
}

export function prepareImportedArticle({ title = '', content = '', translation = '', difficulty = 'cet4', fileName = '' } = {}) {
  const normalizedContent = normalizeImportedContent(content, { format: detectFormat(fileName) });
  const validation = validateImportedContent(normalizedContent);
  if (!validation.valid) {
    const error = new Error(validation.message || '导入内容无效');
    error.code = 'INVALID_IMPORT_CONTENT';
    error.validation = validation;
    throw error;
  }
  return {
    title: text(title).trim() || titleFromFileName(fileName),
    content: normalizedContent,
    translation: normalizeImportedContent(translation),
    difficulty: text(difficulty).trim() || 'cet4',
    topic: 'imported',
    sourceType: 'imported',
    source: 'local',
    wordCount: validation.wordCount
  };
}
