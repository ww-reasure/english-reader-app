import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createArticleQualityService,
  disposeSharedArticleQualityService,
  getSharedArticleQualityService
} from '../src/components/article-quality-service.mjs';

function createDependencies() {
  const calls = {
    fallback: [],
    validator: [],
    disposed: 0,
    analyzerConstructed: 0
  };
  const api = { async chat() { return { content: '{}' }; } };
  const db = {};
  const lexiconLoader = { name: 'versioned-lexicon' };
  const personalProfile = { name: 'direct-evidence-profile' };
  const grammarAnalyzer = {
    analyze: async () => ({ status: 'available', source: 'local', metrics: {} }),
    dispose() { calls.disposed += 1; }
  };

  return {
    api,
    db,
    calls,
    options: {
      createLexiconLoader: () => lexiconLoader,
      createKnowledgeProfileRepository: storage => {
        assert.equal(storage, db);
        return personalProfile;
      },
      GrammarAnalyzer: class {
        constructor() {
          calls.analyzerConstructed += 1;
          return grammarAnalyzer;
        }
      },
      createAiGrammarFallback: input => {
        calls.fallback.push(input);
        return async () => ({ status: 'unavailable', source: 'ai_fallback', reason: 'NOT_USED' });
      },
      createArticleQualityValidator: input => {
        calls.validator.push(input);
        return async () => ({
          passed: true,
          marker: 'composed-validator',
          lexiconProfile: { status: 'available' },
          grammarReport: { status: 'available' },
          personalFit: { status: 'available' }
        });
      }
    }
  };
}

test('composes a local-only background observer without an AI grammar fallback', async () => {
  const { api, db, calls, options } = createDependencies();
  const service = createArticleQualityService({ api, db, ...options });

  assert.equal(typeof service.inspectQuality, 'function');
  assert.equal(service.grammarAnalyzer, service.analyzer);
  assert.equal(calls.analyzerConstructed, 1);
  assert.deepEqual(calls.fallback, []);
  assert.equal(calls.validator.length, 1);
  assert.equal(calls.validator[0].lexiconLoader.name, 'versioned-lexicon');
  assert.equal(calls.validator[0].personalProfile.name, 'direct-evidence-profile');
  assert.equal(calls.validator[0].grammarAnalyzer, service.analyzer);
  assert.equal(calls.validator[0].aiFallback, null);
  const observation = await service.inspectQuality('A passage.');
  assert.equal(observation.status, 'observed');
  assert.equal(observation.report.marker, 'composed-validator');
});

test('reuses the shared observer until an explicit cleanup replaces it', () => {
  disposeSharedArticleQualityService();
  const first = createDependencies();
  const firstService = getSharedArticleQualityService({ api: first.api, db: first.db, ...first.options });
  const sameService = getSharedArticleQualityService({ api: first.api, db: first.db, ...first.options });
  assert.equal(firstService, sameService);
  assert.equal(first.calls.analyzerConstructed, 1);

  disposeSharedArticleQualityService();
  assert.equal(first.calls.disposed, 1);
  const second = createDependencies();
  const secondService = getSharedArticleQualityService({ api: second.api, db: second.db, ...second.options });
  assert.notEqual(secondService, firstService);
  assert.equal(second.calls.analyzerConstructed, 1);
  disposeSharedArticleQualityService();
});
