import { Tooltip } from './tooltip.js';
import { ContextualSense } from './contextual-sense.js';
import { getDefinitionSenses } from './definition-trust.mjs';
import { Dictionary } from '../dictionary.js';
import { getContextSentenceAtPoint } from './reading-word-context.mjs';

const LOOKUP_CONTROL_SELECTOR = 'button, a, input, textarea, select, [role="button"]';
const LOOKUP_DISABLED_SELECTOR = '[data-word-lookup="disabled"], [data-selection-source="option_translations"], [data-selection-source="option_analysis"]';

function pointForEvent(event) {
  return {
    x: Number.isFinite(event?.clientX) ? event.clientX : 12,
    y: Number.isFinite(event?.clientY) ? event.clientY : 12
  };
}

function normalizeSentence(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function bindReadingStyleWordLookup({
  root,
  getContextSentence = event => getContextSentenceAtPoint(event, root),
  getTargetTrack = () => '',
  isReviewWord = () => false,
  shouldIgnoreClick = () => false,
  isEnabled = () => true,
  onHide = () => {},
  onShown = () => {}
} = {}) {
  const tooltip = document.getElementById('wordTooltip');
  if (!root || !tooltip) return () => {};

  let disposed = false;

  const hide = () => {
    Tooltip.hide();
    onHide();
  };

  const globalClickHandler = event => {
    if (disposed || !Tooltip.isVisible() || tooltip.contains(event.target)) return;
    hide();
  };

  const lookupWord = async event => {
    if (disposed) return;
    if (!isEnabled()) return hide();
    if (shouldIgnoreClick(event)) {
      event.stopPropagation();
      return;
    }
    if (tooltip.contains(event.target)) return;

    const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
    if (!target || !root.contains(target)) return;
    if (target.closest?.(LOOKUP_CONTROL_SELECTOR) || target.closest?.(LOOKUP_DISABLED_SELECTOR)) return;

    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed && root.contains(selection.anchorNode)) return;

    if (Tooltip.isVisible()) {
      event.stopPropagation();
      hide();
      return;
    }

    const word = Tooltip.getWordAtPoint(event);
    if (!word || word.length < 2) return;
    event.stopPropagation();

    onHide();
    const { x, y } = pointForEvent(event);
    const lookupId = Tooltip.beginLookup(x, y);

    try {
      const data = await Dictionary.lookup(word);
      if (disposed || !Tooltip.isCurrent(lookupId)) return;
      const contextSentence = normalizeSentence(await getContextSentence(event, { word, data }));
      const reviewWord = Boolean(await isReviewWord(word, data));
      const targetTrack = String(await getTargetTrack({ word, data }) || '').trim();
      const shown = await Tooltip.show(lookupId, x, y, data, reviewWord, { contextSentence, targetTrack });
      if (!shown || disposed) return;

      const senses = getDefinitionSenses(data);
      if (contextSentence && senses.length) {
        void ContextualSense.resolve({
          word: data.baseForm || data.word || word,
          sentence: contextSentence,
          senses,
          lexiconVersion: data.lexiconVersion || ''
        }).then(contextualSense => {
          if (!contextualSense || disposed || !Tooltip.isCurrent(lookupId)) return;
          return Tooltip.show(lookupId, x, y, data, reviewWord, {
            contextSentence,
            targetTrack,
            contextualSenseIndex: contextualSense.senseIndex,
            contextualSenseReason: contextualSense.reasonZh
          });
        }).catch(() => {});
      }

      void Promise.resolve(onShown({ event, word, data, reviewWord, contextSentence, targetTrack, lookupId })).catch(() => {});
    } catch {
      if (!disposed && Tooltip.isCurrent(lookupId)) Tooltip.showError(lookupId, x, y, '暂时无法查询，请稍后重试');
    }
  };

  root.addEventListener('click', lookupWord);
  document.addEventListener('click', globalClickHandler);
  const autoDismissCleanup = Tooltip.attachAutoDismiss();

  return () => {
    disposed = true;
    root.removeEventListener('click', lookupWord);
    document.removeEventListener('click', globalClickHandler);
    autoDismissCleanup?.();
    Tooltip.hide();
  };
}
