export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_WORDS = 50000;
export const MIN_IMPORT_WORDS = 3;

const ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*/g;
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/gu;
const UNSAFE_BLOCK_PATTERN = /<\s*(?:script|style|noscript|template)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style|noscript|template)\s*>/giu;
const HTML_BLOCK_TAG_PATTERN = /<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/giu;
const SUPPORTED_EXTENSIONS = new Map([
  ['txt', 'text'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['html', 'html'],
  ['htm', 'html']
]);
const SUPPORTED_MIME_TYPES = new Map([
  ['text/plain', 'text'],
  ['text/markdown', 'markdown'],
  ['text/x-markdown', 'markdown'],
  ['text/html', 'html'],
  ['application/xhtml+xml', 'html']
]);
const INCONCLUSIVE_MIME_TYPES = new Set(['', 'application/octet-stream']);

const asText = value => String(value ?? '');

function importError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function extensionFor(fileName) {
  const name = asText(fileName).trim().split(/[\\/]/u).pop() || '';
  const match = name.match(/\.([^.]+)$/u);
  return match ? match[1].toLocaleLowerCase('en-US') : '';
}

function normalizeMime(value) {
  return asText(value).split(';', 1)[0].trim().toLocaleLowerCase('en-US');
}

export function detectImportedFormat(file = {}) {
  const extension = extensionFor(file.name);
  const mime = normalizeMime(file.type);
  const extensionFormat = SUPPORTED_EXTENSIONS.get(extension) || null;
  const mimeFormat = SUPPORTED_MIME_TYPES.get(mime) || null;

  if (extension && !extensionFormat) {
    throw importError('UNSUPPORTED_IMPORT_FILE', '仅支持 TXT、Markdown 和 HTML 文件');
  }
  if (!INCONCLUSIVE_MIME_TYPES.has(mime) && !mimeFormat) {
    throw importError('UNSUPPORTED_IMPORT_FILE', '文件类型不受支持，请选择 TXT、Markdown 或 HTML 文件');
  }
  if (extensionFormat && mimeFormat && extensionFormat !== mimeFormat) {
    throw importError('UNSUPPORTED_IMPORT_FILE', '文件扩展名与实际类型不一致');
  }
  const format = extensionFormat || mimeFormat;
  if (!format) {
    throw importError('UNSUPPORTED_IMPORT_FILE', '无法识别文件类型，请选择带扩展名的 TXT、Markdown 或 HTML 文件');
  }
  return format;
}

function decodeHtmlEntities(value) {
  return asText(value)
    .replace(/&nbsp;|&#160;|&#xa0;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (match, rawCode) => {
      const code = Number(rawCode);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return match;
      try { return String.fromCodePoint(code); } catch { return match; }
    })
    .replace(/&#x([\da-f]+);/giu, (match, rawCode) => {
      const code = Number.parseInt(rawCode, 16);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return match;
      try { return String.fromCodePoint(code); } catch { return match; }
    });
}

function stripHtml(value) {
  return decodeHtmlEntities(asText(value)
    .replace(UNSAFE_BLOCK_PATTERN, '')
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(HTML_BLOCK_TAG_PATTERN, '\n\n')
    .replace(/<[^>]*>/gu, ' '));
}

function stripMarkdown(value) {
  return asText(value)
    .replace(UNSAFE_BLOCK_PATTERN, '')
    .replace(/^[ \t]*```[^\n]*$/gmu, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gmu, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gmu, '')
    .replace(/^[ \t]{0,3}(?:[-*+][ \t]+|\d+[.)][ \t]+)/gmu, '')
    .replace(/^[ \t]*(?:---+|___+|\*\*\*+)[ \t]*$/gmu, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/(\*\*|__)(.*?)\1/gu, '$2')
    .replace(/([*_~])(.*?)\1/gu, '$2')
    .replace(HTML_BLOCK_TAG_PATTERN, '\n\n')
    .replace(/<[^>]*>/gu, ' ');
}

function normalizeLines(value) {
  return decodeHtmlEntities(asText(value))
    .replace(/^\uFEFF/u, '')
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

export function normalizeImportedContent(value, { format = 'text' } = {}) {
  const normalizedFormat = asText(format).toLocaleLowerCase('en-US');
  let source = asText(value).replace(/^\uFEFF/u, '');
  if (normalizedFormat === 'html') source = stripHtml(source);
  else if (normalizedFormat === 'markdown' || normalizedFormat === 'md') source = stripMarkdown(source);
  else source = source.replace(UNSAFE_BLOCK_PATTERN, '');
  return normalizeLines(source);
}

export function countEnglishWords(value) {
  return (asText(value).match(ENGLISH_WORD_PATTERN) || []).length;
}

export function validateImportedContent(value, {
  minWords = MIN_IMPORT_WORDS,
  maxWords = MAX_IMPORT_WORDS
} = {}) {
  const content = asText(value).trim();
  const wordCount = countEnglishWords(content);
  const errors = [];
  if (!content) errors.push({ code: 'empty', message: '请输入英文正文' });
  if (content && !/[A-Za-z]/u.test(content)) errors.push({ code: 'not-english', message: '正文需要包含英文内容' });
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

function canonicalFingerprintText(value) {
  return normalizeImportedContent(value)
    .toLocaleLowerCase('en-US')
    .replace(/\s*([,.;:!?()[\]{}"'’])\s*/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hash32(value, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function contentFingerprint(value) {
  const canonical = canonicalFingerprintText(value);
  return `v1-${hash32(canonical, 0x811c9dc5)}${hash32(canonical, 0x9e3779b9)}`;
}

export function titleFromFileName(fileName) {
  const rawName = asText(fileName).trim().split(/[\\/]/u).pop() || '';
  const withoutExtension = rawName.replace(/\.(?:txt|md|markdown|html|htm)$/iu, '');
  return withoutExtension.replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').trim() || '未命名文章';
}

function byteLength(value) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}

export async function parseImportedDocument(file, { maxBytes = MAX_IMPORT_BYTES } = {}) {
  if (!file || typeof file.text !== 'function') {
    throw importError('IMPORT_FILE_UNREADABLE', '无法读取导入文件');
  }
  const limit = Math.max(1, Number(maxBytes) || MAX_IMPORT_BYTES);
  const reportedSize = Number(file.size);
  if (Number.isFinite(reportedSize) && reportedSize > limit) {
    throw importError('IMPORT_FILE_TOO_LARGE', '文件不能超过 2 MiB');
  }
  const format = detectImportedFormat(file);
  let raw;
  try {
    raw = await file.text();
  } catch (cause) {
    throw importError('IMPORT_FILE_UNREADABLE', '文件读取失败', { cause });
  }
  if (byteLength(asText(raw)) > limit) {
    throw importError('IMPORT_FILE_TOO_LARGE', '文件不能超过 2 MiB');
  }
  const content = normalizeImportedContent(raw, { format });
  const validation = validateImportedContent(content);
  if (!validation.valid) {
    throw importError('INVALID_IMPORT_CONTENT', validation.message || '导入内容无效', { validation });
  }
  const fileName = asText(file.name).trim();
  return {
    title: titleFromFileName(fileName),
    content,
    format,
    sourceType: 'imported',
    source: 'local',
    fileName,
    wordCount: validation.wordCount,
    contentFingerprint: contentFingerprint(content)
  };
}

export function prepareImportedArticle({
  title = '',
  content = '',
  translation = '',
  difficulty = 'cet4',
  fileName = ''
} = {}) {
  // File content has already been converted to plain text before it reaches the
  // editable textarea. Treat the user's final edits as text, never as markup.
  const normalizedContent = normalizeImportedContent(content, { format: 'text' });
  const validation = validateImportedContent(normalizedContent);
  if (!validation.valid) {
    throw importError('INVALID_IMPORT_CONTENT', validation.message || '导入内容无效', { validation });
  }
  const normalizedFileName = asText(fileName).trim();
  const normalizedDifficulty = ['cet4', 'cet6', 'kaoyan1', 'kaoyan2', 'graduate'].includes(difficulty)
    ? difficulty
    : 'cet4';
  return {
    title: asText(title).trim() || titleFromFileName(normalizedFileName),
    content: normalizedContent,
    translation: normalizeImportedContent(translation, { format: 'text' }),
    difficulty: normalizedDifficulty,
    topic: 'imported',
    sourceType: 'imported',
    source: 'local',
    fileName: normalizedFileName,
    wordCount: validation.wordCount,
    contentFingerprint: contentFingerprint(normalizedContent)
  };
}
