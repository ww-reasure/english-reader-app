import { normalizeRootFamily, renderRootHighlightedWord } from './affix-root-family.mjs';

const esc = value => String(value ?? '')
  .replace(/&/gu, '&amp;')
  .replace(/</gu, '&lt;')
  .replace(/>/gu, '&gt;')
  .replace(/"/gu, '&quot;')
  .replace(/'/gu, '&#39;');

export const WORD_STUDY_TABS = Object.freeze([
  { id: 'examples', label: '例句' },
  { id: 'roots', label: '词根记忆' },
  { id: 'related', label: '同根词' },
  { id: 'phrases', label: '词组' },
  { id: 'similar', label: '近义词' }
]);

export const isWordStudyTab = tab => WORD_STUDY_TABS.some(item => item.id === tab);

export function renderWordStudyTabs(activeTab = 'examples') {
  return WORD_STUDY_TABS.map(({ id, label }) => `
    <button class="word-study-tab flashcard-study-tab ${activeTab === id ? 'active' : ''}" type="button" role="tab"
      data-study-tab="${id}" aria-selected="${activeTab === id}">${label}</button>`).join('');
}

const normalizeExampleKey = value => String(value || '')
  .toLocaleLowerCase('en-US')
  .replace(/[\u2018\u2019]/gu, "'")
  .replace(/\s+/gu, ' ')
  .trim();

export function normalizeWordStudyExample(value, { isExam = false } = {}) {
  if (typeof value === 'string') {
    const sentenceEn = value.trim();
    return sentenceEn ? { sentenceEn, translationZh: '', isExam: false } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const sentenceEn = String(value.sentenceEn || value.sentence || '').trim();
  if (!sentenceEn) return null;
  return {
    ...value,
    sentenceEn,
    translationZh: String(value.translationZh || '').trim(),
    isExam: Boolean(isExam || value.isExam)
  };
}

export function mergeWordStudyExamples(examExamples = [], genericExamples = [], limit = 10) {
  const seen = new Set();
  const merged = [];
  const add = (value, isExam) => {
    const item = normalizeWordStudyExample(value, { isExam });
    const key = normalizeExampleKey(item?.sentenceEn);
    if (!item || !key || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  };
  for (const example of Array.isArray(examExamples) ? examExamples : []) add(example, true);
  for (const example of Array.isArray(genericExamples) ? genericExamples : []) add(example, false);
  return merged.slice(0, Math.max(0, Number.parseInt(limit, 10) || 0));
}

const WORD_TOKEN_PATTERN = /([A-Za-z]+(?:['’-][A-Za-z]+)*)/gu;

/**
 * Render an English sentence with every word as a lightweight lookup target.
 * The wrapper intentionally stays a span so the sentence remains selectable
 * and keeps the same typography/line wrapping as the surrounding paragraph.
 */
export function renderWordStudyClickableSentence(sentence, { isHighlighted = () => false } = {}) {
  return String(sentence || '').split(WORD_TOKEN_PATTERN).map(part => {
    if (!/^[A-Za-z]/u.test(part)) return esc(part);
    const content = isHighlighted(part)
      ? `<mark class="flashcard-focused-target">${esc(part)}</mark>`
      : esc(part);
    return `<span class="word-study-inline-word" data-word-study-word="${esc(part)}">${content}</span>`;
  }).join('');
}

function examExampleLabel(example) {
  if (example.sourceKind === 'question') return '真题题干';
  if (example.sourceKind === 'passage') return '真题正文';
  return '真题材料';
}

function relatedWordDetails(rootAnalysis) {
  const translations = rootAnalysis?.relatedTranslations || {};
  const rootForms = rootAnalysis?.relatedRootForms || {};
  const rootFamily = normalizeRootFamily(rootAnalysis?.rootFamily);
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(rootAnalysis?.relatedWords) ? rootAnalysis.relatedWords : []) {
    const word = String(typeof item === 'string' ? item : item?.word || '').trim().toLocaleLowerCase('en-US');
    const translation = String(typeof item === 'object' ? item?.translation : translations[word] || '').trim();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    result.push({ word, translation: translation || translations[word] || '', rootForm: rootForms[word] || '' });
  }
  return { rootFamily, items: result };
}

export function renderWordStudyPanel({
  activeTab = 'examples',
  examples = [],
  rootAnalysis = null,
  phrases = { status: 'idle', items: [] },
  similar = { status: 'idle', items: [] }
} = {}) {
  if (activeTab === 'examples') {
    if (!examples.length) return '<div class="word-study-empty flashcard-study-empty">暂无例句。</div>';
    return `<ol class="word-study-example-list">${examples.map((value, index) => {
      const example = normalizeWordStudyExample(value) || { sentenceEn: '', translationZh: '', isExam: false };
      const sourceDetails = [example.paperLabel, example.positionLabel].filter(Boolean).join(' · ');
      return `
      <li class="word-study-example-item flashcard-example-item">
        ${example.isExam ? `<div class="word-study-example-source"><span>${esc(examExampleLabel(example))}</span>${sourceDetails ? `<small>${esc(sourceDetails)}</small>` : ''}</div>` : ''}
        <p class="word-study-example-text flashcard-example-text" data-example-text>${renderWordStudyClickableSentence(example.sentenceEn)}</p>
        <button class="example-translate-btn" type="button" data-example-translate="${index}"${example.translationZh ? ` data-cached-translation="${esc(example.translationZh)}"` : ''} title="翻译例句">译</button>
        <div class="example-translation" data-example-translation="${index}"></div>
      </li>`;
    }).join('')}</ol>`;
  }

  if (activeTab === 'roots') {
    if (!rootAnalysis?.breakdown && !rootAnalysis?.origin && !rootAnalysis?.memoryTip) return '<div class="word-study-empty flashcard-study-empty">暂无词根与记忆资料。</div>';
    return `
      ${rootAnalysis.breakdown || rootAnalysis.origin ? `<section class="word-study-root-section">
        <p class="word-study-section-label">词根拆解</p>
        ${rootAnalysis.breakdown ? `<div class="word-study-root-breakdown flashcard-root-breakdown">${esc(rootAnalysis.breakdown)}</div>` : ''}
        ${rootAnalysis.origin ? `<div class="word-study-root-origin flashcard-root-origin">词源：${esc(rootAnalysis.origin)}</div>` : ''}
      </section>` : ''}
      ${rootAnalysis.memoryTip ? `<section class="word-study-memory-section">
        <p class="word-study-section-label">记忆法</p>
        <p class="word-study-memory-tip flashcard-memory-tip">${esc(rootAnalysis.memoryTip)}</p>
      </section>` : ''}`;
  }

  if (activeTab === 'related') {
    const related = relatedWordDetails(rootAnalysis);
    if (!related.items.length) return '<div class="word-study-empty flashcard-study-empty">暂无同根词。</div>';
    const family = related.rootFamily ? `<div class="word-study-root-family"><span>共同词根</span><strong>${esc(related.rootFamily.label)}</strong><small>${esc(related.rootFamily.meaningZh)}</small></div>` : '';
    return `${family}<div class="word-study-related-list flashcard-related-list">${related.items.map(({ word, translation, rootForm }) => `
      <div class="word-study-related-word flashcard-related-word">
        <span class="word-study-related-term flashcard-related-term">${renderRootHighlightedWord(word, rootForm, esc)}</span>
        <span class="word-study-related-translation flashcard-related-translation">${translation ? esc(translation) : '暂无释义'}</span>
      </div>`).join('')}</div>`;
  }

  if (activeTab === 'phrases') {
    if (phrases.status === 'loading' || phrases.status === 'idle') {
      return '<div class="word-study-loading flashcard-study-loading">正在整理常用词组…</div>';
    }
    if (phrases.status === 'error') {
      return '<div class="word-study-empty flashcard-study-empty"><p>词组暂时加载失败。</p><button class="word-study-retry" type="button" data-retry-phrases>重试</button></div>';
    }
    if (!phrases.items?.length) return '<div class="word-study-empty flashcard-study-empty">暂无可用词组。</div>';
    return `<div class="word-study-phrase-list">${phrases.items.map(({ phrase, glossZh }) => `
      <div class="word-study-phrase-row">
        <span class="word-study-phrase-term">${esc(phrase)}</span>
        <span class="word-study-phrase-gloss">${esc(glossZh)}</span>
      </div>`).join('')}</div>`;
  }

  if (activeTab === 'similar') {
    if (similar.status === 'loading' || similar.status === 'idle') {
      return '<div class="word-study-loading flashcard-study-loading">正在整理近义词…</div>';
    }
    if (similar.status === 'error') {
      return '<div class="word-study-empty flashcard-study-empty"><p>近义词暂时加载失败。</p><button class="word-study-retry" type="button" data-retry-similar>重试</button></div>';
    }
    if (!similar.items?.length) return '<div class="word-study-empty flashcard-study-empty">暂无可用近义词。</div>';
    return `<div class="word-study-similar-list word-study-phrase-list">${similar.items.map(({ word, glossZh, nuanceZh = '' }) => `
      <div class="word-study-similar-row word-study-phrase-row">
        <span class="word-study-similar-term word-study-phrase-term">${esc(word)}</span>
        <span class="word-study-similar-copy">
          <span class="word-study-similar-gloss word-study-phrase-gloss">${esc(glossZh)}</span>
          ${nuanceZh ? `<small class="word-study-similar-nuance">${esc(nuanceZh)}</small>` : ''}
        </span>
      </div>`).join('')}</div>`;
  }

  return '<div class="word-study-empty flashcard-study-empty">暂无学习资料。</div>';
}
