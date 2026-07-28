import { createArticleQualityValidator as defaultCreateArticleQualityValidator } from '../article-quality-validator.mjs';
import { createKnowledgeProfileRepository as defaultCreateKnowledgeProfileRepository } from '../knowledge-profile.mjs';
import { createLexiconLoader as defaultCreateLexiconLoader } from '../lexicon-runtime.mjs';
import { GrammarAnalyzer as DefaultGrammarAnalyzer } from './grammar-analyzer.mjs';

let sharedService = null;

/**
 * Composition root for the article quality gate.
 *
 * Every article entry point receives the same versioned lexicon, direct
 * evidence profile and one lazy UDPipe worker.  Keeping this in a dedicated
 * module prevents a review flow from silently falling back to the old
 * word-count-only validator.
 */
export function createArticleQualityService({
  api,
  db,
  createLexiconLoader = defaultCreateLexiconLoader,
  createKnowledgeProfileRepository = defaultCreateKnowledgeProfileRepository,
  GrammarAnalyzer = DefaultGrammarAnalyzer,
  createArticleQualityValidator = defaultCreateArticleQualityValidator
} = {}) {
  if (!api || typeof api.chat !== 'function') throw new TypeError('文章质量服务需要 chat API');
  if (!db || typeof db !== 'object') throw new TypeError('文章质量服务需要数据库');
  if (typeof createLexiconLoader !== 'function'
    || typeof createKnowledgeProfileRepository !== 'function'
    || typeof GrammarAnalyzer !== 'function'
    || typeof createArticleQualityValidator !== 'function') {
    throw new TypeError('文章质量服务依赖无效');
  }

  const lexiconLoader = createLexiconLoader();
  const personalProfile = createKnowledgeProfileRepository(db);
  const analyzer = new GrammarAnalyzer();
  // Quality inspection is intentionally local-only. A missing grammar model
  // is recorded as an observation gap after saving; it must never spend a
  // second AI request or turn a usable article into a failed generation.
  const inspect = createArticleQualityValidator({
    lexiconLoader,
    personalProfile,
    grammarAnalyzer: analyzer,
    aiFallback: null
  });
  if (typeof inspect !== 'function') throw new TypeError('文章质量校验器必须是函数');

  const inspectQuality = async (content, profile, targetWords, options) => {
    const report = await inspect(content, profile, targetWords, options);
    const unavailableReason = report?.grammarReport?.status === 'unavailable'
      ? 'GRAMMAR_OBSERVATION_UNAVAILABLE'
      : report?.lexiconProfile?.status !== 'available'
        ? 'LEXICON_OBSERVATION_UNAVAILABLE'
        : report?.personalFit?.status === 'unavailable'
          ? 'PERSONALIZATION_OBSERVATION_UNAVAILABLE'
          : '';
    return unavailableReason
      ? { status: 'unavailable', reason: unavailableReason, report }
      : { status: 'observed', report };
  };

  let disposed = false;
  return {
    inspectQuality,
    // Kept as a compatibility alias for integrations outside the app. New
    // generation entry points use inspectQuality explicitly.
    validate: inspectQuality,
    analyzer,
    grammarAnalyzer: analyzer,
    dispose() {
      if (disposed) return;
      disposed = true;
      analyzer?.dispose?.();
    }
  };
}

export function getSharedArticleQualityService(options = {}) {
  const { api, db } = options;
  if (sharedService?.api === api && sharedService?.db === db) return sharedService.service;
  disposeSharedArticleQualityService();
  sharedService = {
    api,
    db,
    service: createArticleQualityService(options)
  };
  return sharedService.service;
}

/**
 * Legacy adapter retained for external callers. New code should use
 * getSharedArticleQualityService().inspectQuality.
 */
export function getSharedArticleQualityValidator(options = {}) {
  return getSharedArticleQualityService(options).inspectQuality;
}

export function disposeSharedArticleQualityService() {
  sharedService?.service?.dispose?.();
  sharedService = null;
}
