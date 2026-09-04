import { Tooltip } from './tooltip.js';
import { ContextualSense } from './contextual-sense.js';
import { getDefinitionSenses } from './definition-trust.mjs';
import { Dictionary } from '../dictionary.js';
import { getContextSentenceAtPoint } from './reading-word-context.mjs';
import { bindSentenceLongPress } from './sentence-long-press.mjs';

export { getContextSentenceAtPoint } from './reading-word-context.mjs';

const LOOKUP_CONTROL_SELECTOR = 'button, a, input, textarea, select, [role="button"]';
const LOOKUP_DISABLED_SELECTOR = 'code, pre, [data-word-lookup="disabled"], [data-selection-source="option_translations"], [data-selection-source="option_analysis"]';

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
export function bindLearningTextLookup({
  root,
  surface = 'reading',
  clickScopeSelector = '[data-learning-text="click"]',
  longPressScopeSelector = '[data-learning-text="longpress"]',
  longPressDuration = 450,
  longPressMovementThreshold = 12,
  tooltipDensity = 'compact',
  closeBeforeLookup = true,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  dictionary = Dictionary,
  tooltip: tooltipOverride = null,
  getContextSentence = event => getContextSentenceAtPoint(event, root),
  getTargetTrack = () => '',
  isReviewWord = () => false,
  shouldIgnoreClick = () => false,
  isEnabled = () => true,
  resolveKeyPhrase = null,
  onHide = () => {},
  onShown = () => {},
  onLookupResolved = null,
  onWordSaved = null,
  lookupContext = {}
} = {}) {
  const tooltipApi = tooltipOverride && typeof tooltipOverride.beginLookup === 'function' ? tooltipOverride : Tooltip;
  let tooltip = tooltipOverride && typeof tooltipOverride.contains === 'function'
    ? tooltipOverride
    : document.getElementById('wordTooltip');
  if (!root) return () => {};
  let ownsTooltip = false;
  if (!tooltip && document.createElement && root.appendChild) {
    tooltip = document.createElement('div');
    tooltip.id = 'wordTooltip';
    tooltip.className = 'word-tooltip';
    tooltip.style.display = 'none';
    root.appendChild(tooltip);
    ownsTooltip = true;
  }
  if (!tooltip) return () => {};

  let disposed = false;
  let suppressedClickTarget = null;
  let suppressionTimer = null;
  const isolatedSurface = surface === 'guide' || surface === 'isolated';

  const clearClickSuppression = () => {
    if (suppressionTimer != null) clearTimer(suppressionTimer);
    suppressionTimer = null;
    suppressedClickTarget = null;
  };

  const hide = () => {
    tooltipApi.hide();
    onHide();
  };

  const globalClickHandler = event => {
    if (disposed || !tooltipApi.isVisible() || tooltip.contains(event.target)) return;
    hide();
  };

  const lookupWord = async (event, { mode = 'click', allowControl = false } = {}) => {
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
    const learningTextTarget = mode === 'click' && clickScopeSelector
      ? target.closest?.(clickScopeSelector || '[data-learning-text="click"]')
      : null;
    if (mode === 'click' && clickScopeSelector && !learningTextTarget) return;
    if (mode === 'click' && isolatedSurface && !tokenTarget) return;
    if ((!allowControl && !tokenTarget && target.closest?.(LOOKUP_CONTROL_SELECTOR)) || target.closest?.(LOOKUP_DISABLED_SELECTOR)) return;

    const selection = window.getSelection?.();
    if (mode === 'click' && event.type !== 'keydown' && selection && !selection.isCollapsed && root.contains(selection.anchorNode)) return;

    // Match reading behavior: the first body click closes the current card.
    if (tooltipApi.isVisible()) {
      event.stopPropagation?.();
      hide();
      if (mode === 'click' && closeBeforeLookup) return;
    }

    // 词组卡优先：命中重点词组时展示词组释义，而不是单词查词。
    if (typeof resolveKeyPhrase === 'function') {
      const phraseTarget = target.closest?.('[data-key-phrase-id]');
      const phraseId = String(phraseTarget?.dataset?.keyPhraseId || '').trim();
      if (phraseTarget && phraseId) {
        const phraseData = await resolveKeyPhrase(phraseId);
        if (disposed) return;
        if (phraseData) {
          event.stopPropagation?.();
          onHide();
          const { x, y } = pointForEvent(event, phraseTarget);
          const phraseLookupId = tooltipApi.beginLookup(x, y);
          if (typeof tooltipApi.showPhrase === 'function') {
            tooltipApi.showPhrase(phraseLookupId, x, y, {
              phrase: phraseData.phrase || phraseId,
              glossZh: phraseData.glossZh || phraseData.g || ''
            });
          } else {
            tooltipApi.hide();
          }
          return;
        }
      }
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
        density: tooltipDensity,
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
        tooltipApi.showError(lookupId, x, y, '暂时无法查询，请稍后重试', () => {
          if (disposed || !tooltipApi.isCurrent(lookupId)) return false;
          tooltipApi.hide();
          return lookupWord(event, { mode, allowControl });
        });
      }
    }
  };

  const keydownHandler = event => {
    if (!['Enter', ' '].includes(event.key)) return;
    const phraseTarget = event.target?.closest?.('[data-key-phrase-id]');
    const target = phraseTarget || event.target?.closest?.('[data-word-lookup-token]');
    if (!target || !root.contains(target)) return;
    event.preventDefault?.();
    void lookupWord(event);
  };

  const suppressLongPressClick = event => {
    if (!suppressedClickTarget) return false;
    const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
    const belongsToLongPress = target && (
      target === suppressedClickTarget
      || suppressedClickTarget.contains?.(target)
      || target.closest?.(longPressScopeSelector) === suppressedClickTarget
    );
    if (!belongsToLongPress) return false;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    clearClickSuppression();
    return true;
  };

  const clickHandler = event => {
    if (suppressLongPressClick(event)) return;
    return lookupWord(event);
  };

  const longPressCleanup = longPressScopeSelector
    ? bindSentenceLongPress({
      root,
      duration: longPressDuration,
      movementThreshold: longPressMovementThreshold,
      preventNativeTextSelection: true,
      setTimer,
      clearTimer,
      shouldIgnore: event => {
        const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
        if (!target || !root.contains(target) || target.closest?.(LOOKUP_DISABLED_SELECTOR)) return true;
        return !target.closest?.(longPressScopeSelector);
      },
      onLongPress: event => {
        const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
        const scope = target?.closest?.(longPressScopeSelector);
        if (!scope) return;
        clearClickSuppression();
        suppressedClickTarget = scope;
        suppressionTimer = setTimer(clearClickSuppression, 800);
        void lookupWord(event, { mode: 'longpress', allowControl: true });
      }
    })
    : () => {};

  const clickCapture = Boolean(longPressScopeSelector);
  root.addEventListener('click', clickHandler, clickCapture);
  root.addEventListener('keydown', keydownHandler);
  document.addEventListener('click', globalClickHandler);
  const autoDismissCleanup = tooltipApi.attachAutoDismiss?.() || (() => {});

  return () => {
    disposed = true;
    clearClickSuppression();
    longPressCleanup();
    root.removeEventListener('click', clickHandler, clickCapture);
    root.removeEventListener('keydown', keydownHandler);
    document.removeEventListener('click', globalClickHandler);
    autoDismissCleanup?.();
    tooltipApi.hide();
    if (ownsTooltip) tooltip.remove?.();
  };
}

export function bindReadingStyleWordLookup(options = {}) {
  return bindLearningTextLookup({
    clickScopeSelector: '',
    longPressScopeSelector: '',
    tooltipDensity: 'full',
    ...options
  });
}
