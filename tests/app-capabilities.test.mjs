import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APP_CAPABILITY_CATALOG_VERSION,
  AppCapabilityRegistry,
  createCapabilityActionArtifact
} from '../src/components/app-capabilities.mjs';

test('capability registry covers the public learning flows including both review modes', () => {
  assert.ok(APP_CAPABILITY_CATALOG_VERSION >= 1);
  const results = AppCapabilityRegistry.search({ query: '复习' });
  const ids = results.map(item => item.id);

  assert.ok(ids.includes('word_review'));
  assert.ok(ids.includes('context_review'));
  assert.equal(results.find(item => item.id === 'context_review').route, '#/flashcard/context');
});

test('capability action artifacts accept only registered actions and at most three buttons', () => {
  const artifact = createCapabilityActionArtifact([
    { capabilityId: 'context_review', label: '开始语境识词' },
    { capabilityId: 'reading_library', label: '去书架' },
    { capabilityId: 'learning_profile', label: '查看档案' },
    { capabilityId: 'missing', label: '不存在' },
    { capabilityId: 'word_review', label: '第四个按钮' }
  ]);

  assert.equal(artifact.type, 'app_actions');
  assert.deepEqual(artifact.actions.map(item => item.capabilityId), [
    'context_review',
    'reading_library',
    'learning_profile'
  ]);
  assert.ok(artifact.actions.every(item => item.route.startsWith('#/')));
});

test('stable capability index is deterministic and excludes long detail fields', () => {
  const first = AppCapabilityRegistry.compactIndex();
  const second = AppCapabilityRegistry.compactIndex();

  assert.equal(first, second);
  assert.match(first, /语境识词/);
  assert.doesNotMatch(first, /dataSources|prerequisites/);
});
