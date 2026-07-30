import assert from 'node:assert/strict';
import test from 'node:test';
import { HomeGenerationCoordinator } from '../src/components/home-generation-coordinator.mjs';

function createStore(seed = null) {
  let value = seed;
  return {
    load: () => value && structuredClone(value),
    save: next => { value = structuredClone(next); },
    clear: () => { value = null; },
    snapshot: () => value && structuredClone(value)
  };
}

test('detaching a page does not abort an active generation job', async () => {
  const store = createStore();
  let release;
  let receivedSignal;
  const coordinator = new HomeGenerationCoordinator({
    store,
    execute: (_job, { signal }) => new Promise(resolve => {
      receivedSignal = signal;
      release = () => resolve({ articleIds: [17] });
    })
  });

  const running = coordinator.start({ id: 'job-route', kind: 'direct', payload: { topic: 'science' } });
  coordinator.detach();
  assert.equal(receivedSignal.aborted, false);
  release();

  const completed = await running;
  assert.equal(completed.status, 'completed');
  assert.deepEqual(store.snapshot().articleIds, [17]);
});

test('a hidden interruption automatically resumes exactly once when visible again', async () => {
  const store = createStore();
  let attempts = 0;
  const coordinator = new HomeGenerationCoordinator({
    store,
    execute: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('network interrupted');
      return { articleIds: [23] };
    }
  });

  coordinator.setVisibility('hidden');
  const interrupted = await coordinator.start({ id: 'job-resume', kind: 'direct', payload: { topic: 'travel' } });
  assert.equal(interrupted.status, 'interrupted');

  const completed = await coordinator.setVisibility('visible');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.retryCount, 1);
  assert.equal(attempts, 2);
});

test('an explicit cancellation is the only path that aborts an active job', async () => {
  const store = createStore();
  let receivedSignal;
  const coordinator = new HomeGenerationCoordinator({
    store,
    execute: (_job, { signal }) => new Promise(() => { receivedSignal = signal; })
  });

  void coordinator.start({ id: 'job-cancel', kind: 'direct', payload: {} });
  coordinator.cancel('clear_context');

  assert.equal(receivedSignal.aborted, true);
  assert.equal(store.snapshot().status, 'cancelled');
  assert.equal(store.snapshot().cancelReason, 'clear_context');
});

test('a persisted unfinished job is retried once after a process restart', async () => {
  const store = createStore({
    id: 'job-restart',
    kind: 'direct',
    payload: { topic: 'culture' },
    status: 'running',
    retryCount: 0,
    articleIds: []
  });
  let attempts = 0;
  const coordinator = new HomeGenerationCoordinator({
    store,
    execute: async () => { attempts += 1; return { articleIds: [31] }; }
  });

  const completed = await coordinator.resumePending();
  assert.equal(completed.status, 'completed');
  assert.equal(completed.retryCount, 1);
  assert.equal(attempts, 1);
});

test('persists completed review batches before a hidden interruption', async () => {
  const store = createStore();
  const coordinator = new HomeGenerationCoordinator({
    store,
    execute: async (_job, { updateJob }) => {
      updateJob({ completedBatches: [0], articleIds: [44] });
      throw new Error('network interrupted');
    }
  });

  coordinator.setVisibility('hidden');
  const interrupted = await coordinator.start({ id: 'job-review', kind: 'review', payload: { batches: [['alpha'], ['beta']] } });

  assert.equal(interrupted.status, 'interrupted');
  assert.deepEqual(store.snapshot().completedBatches, [0]);
  assert.deepEqual(store.snapshot().articleIds, [44]);
});

test('persists publication and activity markers to avoid duplicate recovery events', async () => {
  const store = createStore();
  const coordinator = new HomeGenerationCoordinator({
    store,
    execute: async (_job, { updateJob }) => {
      updateJob({ activityRecorded: true, failureId: 'failure-55', publishedArticleIds: [55] });
      return { articleIds: [55] };
    }
  });

  await coordinator.start({ id: 'job-markers', kind: 'direct', payload: {} });

  assert.equal(store.snapshot().activityRecorded, true);
  assert.equal(store.snapshot().failureId, 'failure-55');
  assert.deepEqual(store.snapshot().publishedArticleIds, [55]);
});

test('keeps draft previews in memory and clears them after a job completes', async () => {
  const store = createStore();
  const previews = [];
  const coordinator = new HomeGenerationCoordinator({
    store,
    onPreview: preview => previews.push(preview),
    execute: async (_job, { updatePreview }) => {
      updatePreview({ batchIndex: 1, title: 'Draft', content: 'First sentence.', wordCount: 2 });
      return { articleIds: [66] };
    }
  });

  await coordinator.start({ id: 'job-preview', kind: 'review', payload: {} });

  assert.equal(previews[0].title, 'Draft');
  assert.equal(previews.at(-1).preview, null);
  assert.equal(coordinator.getPreview('job-preview', 1), null);
  assert.equal(store.snapshot().preview, undefined);
});
