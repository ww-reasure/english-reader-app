import { esc, getStemForm } from '../helpers.js';
import { normalizeWordStudyExample, renderWordStudyClickableSentence } from './word-study-materials.mjs';

export function getHorizontalSwipeDirection({ startX, startY, endX, endY } = {}) {
  const deltaX = Number(endX) - Number(startX);
  const deltaY = Number(endY) - Number(startY);
  if (![deltaX, deltaY].every(Number.isFinite)) return null;
  if (Math.abs(deltaX) < 44 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return null;
  return deltaX < 0 ? 'next' : 'previous';
}

export function renderWordStudyDefinitionLine(line, className = 'flashcard-study-translation') {
  return `<div class="${className} definition-line"><span class="definition-pos">${esc(line.label)}</span><span>${esc(line.glossZh)}</span></div>`;
}

export function renderHighlightedWordStudySentence(sentence, targetWord) {
  const targetStem = getStemForm(targetWord);
  return renderWordStudyClickableSentence(sentence, {
    isHighlighted: part => getStemForm(part) === targetStem
      || part.toLocaleLowerCase('en-US') === String(targetWord || '').toLocaleLowerCase('en-US')
  });
}

function focusedExampleSourceLabel(example) {
  if (!example?.isExam) return '学习例句';
  if (example.sourceKind === 'question') return '真题题干';
  if (example.sourceKind === 'passage') return '真题例句';
  return '真题材料';
}

export function getFocusedWordStudyExamples(examples, limit = 5) {
  return (Array.isArray(examples) ? examples : [])
    .map((rawExample, sourceIndex) => ({
      example: normalizeWordStudyExample(rawExample),
      sourceIndex
    }))
    .filter(item => item.example?.sentenceEn)
    .map(item => {
      const wordCount = item.example.sentenceEn.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/gu)?.length || 0;
      const isComfortableLength = wordCount >= 6 && wordCount <= 28;
      const bucket = item.example.isExam
        ? (isComfortableLength ? 0 : 2)
        : (isComfortableLength ? 1 : 3);
      return { ...item, bucket, distanceFromIdeal: Math.abs(wordCount - 18) };
    })
    .sort((a, b) => a.bucket - b.bucket
      || a.distanceFromIdeal - b.distanceFromIdeal
      || a.sourceIndex - b.sourceIndex)
    .slice(0, limit);
}

export function renderFocusedWordStudyExample({ examples, index = 0, targetWord = '' } = {}) {
  const focusedExamples = getFocusedWordStudyExamples(examples);
  if (!focusedExamples.length) return '<div class="word-study-empty flashcard-study-empty">暂无例句。</div>';

  const safeIndex = Math.min(Math.max(0, Number(index) || 0), focusedExamples.length - 1);
  const { example, sourceIndex } = focusedExamples[safeIndex];
  const sourceDetails = [example.paperLabel, example.positionLabel].filter(Boolean).join(' · ');
  const dots = focusedExamples.map((_, dotIndex) => `
    <button type="button" data-example-select="${dotIndex}" class="${dotIndex === safeIndex ? 'active' : ''}"
      aria-label="查看第 ${dotIndex + 1} 条例句" aria-current="${dotIndex === safeIndex ? 'true' : 'false'}"></button>`).join('');

  return `<article class="word-study-example-item flashcard-example-item flashcard-focused-example" data-example-carousel>
    <div class="flashcard-focused-example-topline">
      <span class="flashcard-focused-source"><i class="fa-solid fa-book-open" aria-hidden="true"></i>${esc(focusedExampleSourceLabel(example))}</span>
      <button class="example-translate-btn flashcard-focused-translate" type="button" data-example-translate="${sourceIndex}"${example.translationZh ? ` data-cached-translation="${esc(example.translationZh)}"` : ''}>译</button>
    </div>
    <p class="word-study-example-text flashcard-example-text flashcard-focused-sentence" data-example-text>${renderHighlightedWordStudySentence(example.sentenceEn, targetWord)}</p>
    <div class="example-translation flashcard-focused-translation" data-example-translation="${sourceIndex}"></div>
    ${sourceDetails ? `<p class="flashcard-focused-example-source">${esc(sourceDetails)}</p>` : ''}
    <div class="flashcard-focused-pagination" aria-label="例句分页">
      <div class="flashcard-focused-dots">${dots}</div>
      <span>${safeIndex + 1} / ${focusedExamples.length}</span>
    </div>
    <button class="flashcard-show-all-examples" type="button" data-example-show-all>
      <i class="fa-regular fa-rectangle-list" aria-hidden="true"></i>
      <span>查看全部例句</span>
      <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
    </button>
  </article>`;
}
