const ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:['’'-][A-Za-z]+)*/g;

export function parseSseChunk(chunk = '', remainder = '') {
  const lines = `${String(remainder || '')}${String(chunk || '')}`.split(/\r?\n/);
  const nextRemainder = lines.pop() || '';
  const events = [];
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    events.push(line.slice(5).replace(/^\s/, ''));
  }
  return { events, remainder: nextRemainder };
}

function readJsonString(raw, start) {
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character !== '"') continue;
    try {
      return {
        complete: true,
        value: JSON.parse(`"${raw.slice(start, index)}"`),
        end: index + 1
      };
    } catch {
      return { complete: false, value: '' };
    }
  }
  const partial = raw.slice(start);
  const safePartial = partial.endsWith('\\') ? partial.slice(0, -1) : partial;
  try {
    return { complete: false, value: JSON.parse(`"${safePartial}"`) };
  } catch {
    return { complete: false, value: safePartial.replace(/\\"/g, '"').replace(/\\\\/g, '\\') };
  }
}

function extractStringField(raw, field) {
  const matcher = new RegExp(`"${String(field).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"`, 'g');
  const match = matcher.exec(raw);
  if (!match) return '';
  return readJsonString(raw, matcher.lastIndex).value;
}

export function extractArticleDraft(raw = '') {
  const source = String(raw || '');
  const content = extractStringField(source, 'content');
  return {
    title: extractStringField(source, 'title'),
    titleZh: extractStringField(source, 'titleZh'),
    content,
    translation: extractStringField(source, 'translation')
  };
}

export function createArticleStreamParser({ onDraft = null } = {}) {
  let raw = '';
  let lastDraft = extractArticleDraft('');

  const emit = () => {
    const nextDraft = extractArticleDraft(raw);
    const draft = { ...nextDraft, wordCount: (nextDraft.content.match(ENGLISH_WORD_PATTERN) || []).length };
    if (JSON.stringify(draft) === JSON.stringify(lastDraft)) return draft;
    lastDraft = draft;
    if (typeof onDraft === 'function') onDraft({ ...draft });
    return draft;
  };

  return {
    push(delta = '') {
      raw += String(delta || '');
      return emit();
    },
    getRaw() {
      return raw;
    },
    getDraft() {
      return { ...lastDraft };
    },
    finish() {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('文章 JSON 格式无效');
      }
      return {
        title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
        titleZh: typeof parsed.titleZh === 'string' ? parsed.titleZh.trim() : '',
        content: typeof parsed.content === 'string' ? parsed.content : '',
        translation: typeof parsed.translation === 'string' ? parsed.translation : ''
      };
    }
  };
}
