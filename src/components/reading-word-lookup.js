import { Tooltip } from './tooltip.js';
import { ContextualSense } from './contextual-sense.js';
import { getDefinitionSenses } from './definition-trust.mjs';
import { Dictionary } from '../dictionary.js';
import { getContextSentenceAtPoint } from './reading-word-context.mjs';

export { getContextSentenceAtPoint } from './reading-word-context.mjs';

const LOOKUP_CONTROL_SELECTOR = 'button, a, input, textarea, select, [role="button"]';
const LOOKUP_DISABLED_SELECTOR = '[data-word-lookup="disabled"], [data-selection-source="option_translations"], [data-selection-source="option_analysis"]';

function pointForEvent(event, target) {
  const rect = target?.getBoundingClientRect?.();
  const hasPointerCoordinates = event?.type !== 'keydown'
    && Number.isFinite(event?.clientX)
    && Number.isFinite(event?.clientY);
  return {
    x: hasPointerCoordinates ? event.clientX : Number.isFinite(rect?.left) ? rect.left + Math.min(rect.width || 0, 18) : 12,
    y: hasPointerCoordinates ? event.clientY : Number.isFinite(rect?.bottom) ? rect.bottom + 4 : 12
  };
}

function normalizeSentence(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Bind the reading page's word lookup interaction to any text surface.
 * Callers own persistence and selection actions; this binding only owns the
 * shared tooltip lifecycle and dictionary/context lookup.
 */
export function bindReadingStyleWordLookup({
  root,
  surface = 'reading',
  dictionary = Dictionary,
  tooltip: tooltipOverride = null,
  getContextSentence = event => getContextSentenceAtPoint(event, root),
  getTargetTrack = () => '',
  isReviewWord = () => false,
  shouldIgnoreClick = () => false,
  isEnabled = () => true,
  onHide = () => {},
  onShown = () => {},
  onLookupResolved = null,
  onWordSaved = null,
  lookupContext = {}
} = {}) {
  const tooltipApi = tooltipOverride && typeof tooltipOverride.beginLookup === 'function' ? tooltipOverride : Tooltip;
  const tooltip = tooltipOverride && typeof tooltipOverride.contains === 'function'
    ? tooltipOverride
    : document.getElementById('wordTooltip');
  if (!root || !tooltip) return () => {};

  let disposed = false;
  const isolatedSurface = surface === 'guide' || surface === 'isolated';

  const hide = () => {
    tooltipApi.hide();
    onHide();
  };

  const globalClickHandler = event => {
    if (disposed || !tooltipApi.isVisible() || tooltip.contains(event.target)) return;
    hide();
  };

  const lookupWord = async event => {
    if (disposed) return;
    if (!isEnabled()) return hide();
    if (shouldIgnoreClick(event)) {
      event.stopPropagation?.();
      return;
    }
    if (tooltip.contains(event.target)) return;

    const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
    if (!target || !root.contains(target)) return;
    const tokenTarget = target.dataset?.wordLookupToken ? target : target.closest?.('[data-word-lookup-token]');
    if (isolatedSurface && !tokenTarget) return;
    if ((!tokenTarget && target.closest?.(LOOKUP_CONTROL_SELECTOR)) || target.closest?.(LOOKUP_DISABLED_SELECTOR)) return;

    const selection = window.getSelection?.();
    if (event.type !== 'keydown' && selection && !selection.isCollapsed && root.contains(selection.anchorNode)) return;

    // Match reading behavior: the first body click closes the current card.
    if (tooltipApi.isVisible()) {
      event.stopPropagation?.();
      hide();
      return;
    }

    const word = String(tokenTarget?.dataset?.wordLookupToken || tooltipApi.getWordAtPoint?.(event) || '').trim();
    if (!word || word.length < 2) return;
    event.stopPropagation?.();

    onHide();
    const { x, y } = pointForEvent(event, tokenTarget || target);
    const lookupId = tooltipApi.beginLookup(x, y);

    try {
      const data = await dictionary.lookup(word);
      if (disposed || !tooltipApi.isCurrent(lookupId)) return;
      const contextSentence = normalizeSentence(await getContextSentence(event, { word, data }));
      const reviewWord = Boolean(await isReviewWord(word, data));
      const targetTrack = String(await getTargetTrack({ word, data }) || '').trim();
      const resolvedLookupContext = typeof lookupContext === 'function'
        ? await lookupContext({ event, word, data, surface })
        : lookupContext || {};
      const tooltipOptions = {
        contextSentence,
        targetTrack,
        lookupContext: resolvedLookupContext,
        onWordSaved
      };
      const shown = await tooltipApi.show(lookupId, x, y, data, reviewWord, tooltipOptions);
      if (!shown || disposed || !tooltipApi.isCurrent(lookupId)) return;

      const lookupPayload = {
        event,
        word,
        lemma: word.toLowerCase(),
        data,
        reviewWord,
        contextSentence,
        targetTrack,
        lookupId,
        surface,
        lookupContext: resolvedLookupContext
      };
      if (typeof onLookupResolved === 'function') {
        try {
          void Promise.resolve(onLookupResolved(lookupPayload)).catch(error => {
            console.warn('Learning lookup telemetry failed.', error);
          });
        } catch (error) {
          console.warn('Learning lookup telemetry failed.', error);
        }
      }

      const senses = getDefinitionSenses(data);
      if (contextSentence && senses.length) {
        void ContextualSense.resolve({
          word: data.baseForm || data.word || word,
          sentence: contextSentence,
          senses,
          lexiconVersion: data.lexiconVersion || ''
        }).then(contextualSense => {
          if (!contextualSense || disposed || !tooltipApi.isCurrent(lookupId)) return;
          return tooltipApi.show(lookupId, x, y, data, reviewWord, {
            ...tooltipOptions,
            contextualSenseIndex: contextualSense.senseIndex,
            contextualSenseReason: contextualSense.reasonZh
          });
        }).catch(() => {});
      }

      void Promise.resolve(onShown({
        event,
        word,
        data,
        stem: word.toLowerCase(),
        reviewWord,
        contextSentence,
        targetTrack,
        lookupId,
        surface
      })).catch(() => {});
    } catch {
      if (!disposed && tooltipApi.isCurrent(lookupId)) {
        tooltipApi.showError(lookupId, x, y, '暂时无法查询，请稍后重试');
      }
    }
  };

  const keydownHandler = event => {
    if (!['Enter', ' '].includes(event.key)) return;
    const target = event.target?.closest?.('[data-word-lookup-token]');
    if (!target || !root.contains(target)) return;
    event.preventDefault?.();
    void lookupWord(event);
  };

  root.addEventListener('click', lookupWord);
  root.addEventListener('keydown', keydownHandler);
  document.addEventListener('click', globalClickHandler);
  const autoDismissCleanup = tooltipApi.attachAutoDismiss?.() || (() => {});

  return () => {
    disposed = true;
    root.removeEventListener('click', lookupWord);
    root.removeEventListener('keydown', keydownHandler);
    document.removeEventListener('click', globalClickHandler);
    autoDismissCleanup?.();
    tooltipApi.hide();
  };
}
