import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  analyzeDependencyDocument,
  createUnavailableGrammarAnalysis,
  validateLocalGrammarManifest,
} from '../src/components/grammar-analyzer-contract.mjs';
import { GrammarAnalyzer } from '../src/components/grammar-analyzer.mjs';
import { createGrammarWorkerRuntime } from '../src/workers/grammar-analyzer-runtime.mjs';
import { createUdpipeDocumentLoader } from '../src/workers/grammar-udpipe-adapter.mjs';
import {
  createGrammarProfile,
  validateGrammarProfile,
} from '../src/grammar-profile.mjs';

const eligibleManifest = {
  schemaVersion: 1,
  runtime: {
    id: 'udpipe-wasm',
    status: 'bundled',
    loaderUrl: '/models/grammar/udpipe-loader.mjs',
    wasmUrl: '/models/grammar/udpipe.wasm',
  },
  model: {
    id: 'english-ud-2.1',
    status: 'bundled',
    url: '/models/grammar/english.udpipe',
  },
};

const bundledModuleManifest = {
  ...eligibleManifest,
  runtime: {
    id: 'udpipe-wasm',
    status: 'bundled',
    moduleId: 'udpipe-wasm-v1',
    loaderUrl: null,
    wasmUrl: null,
  },
};

test('an unavailable local parser produces a typed result without fabricated syntax metrics', () => {
  const result = createUnavailableGrammarAnalysis('MODEL_NOT_BUNDLED');

  assert.deepEqual(result, {
    status: 'unavailable',
    source: 'local',
    reason: 'MODEL_NOT_BUNDLED',
    metrics: null,
  });
});

test('local parsing is eligible only with an explicitly bundled runtime and model', () => {
  assert.deepEqual(validateLocalGrammarManifest(eligibleManifest), {
    status: 'eligible',
    source: 'local',
  });

  assert.deepEqual(validateLocalGrammarManifest({
    ...eligibleManifest,
    model: { ...eligibleManifest.model, status: 'not-bundled', url: null },
  }), {
    status: 'unavailable',
    source: 'local',
    reason: 'MODEL_NOT_BUNDLED',
    metrics: null,
  });
});

test('a bundled worker module can satisfy the local runtime contract without exposing a dynamic loader URL', () => {
  assert.deepEqual(validateLocalGrammarManifest(bundledModuleManifest), {
    status: 'eligible',
    source: 'local',
  });
});

test('a verified dependency document reports dependency evidence without claiming a parser result is a grammar grade', () => {
  const analysis = analyzeDependencyDocument({
    sentences: [
      {
        tokens: [
          { id: 1, form: 'Although', lemma: 'although', upos: 'SCONJ', head: 5, deprel: 'mark' },
          { id: 2, form: 'committee', lemma: 'committee', upos: 'NOUN', head: 5, deprel: 'nsubj:pass' },
          { id: 3, form: 'was', lemma: 'be', upos: 'AUX', head: 5, deprel: 'aux:pass' },
          { id: 4, form: 'to', lemma: 'to', upos: 'PART', head: 5, deprel: 'mark' },
          { id: 5, form: 'formed', lemma: 'form', upos: 'VERB', head: 8, deprel: 'advcl' },
          { id: 6, form: 'review', lemma: 'review', upos: 'VERB', head: 5, deprel: 'xcomp' },
          { id: 7, form: 'it', lemma: 'it', upos: 'PRON', head: 8, deprel: 'nsubj' },
          { id: 8, form: 'decided', lemma: 'decide', upos: 'VERB', head: 0, deprel: 'root' },
        ],
      },
    ],
  });

  assert.equal(analysis.status, 'available');
  assert.equal(analysis.source, 'local');
  assert.deepEqual(analysis.metrics, {
    sentenceCount: 1,
    tokenCount: 8,
    clauseRelationCount: 2,
    passivePredicateCount: 1,
    nonFiniteRelationCount: 1,
    maxDependencyDepth: 3,
    relations: {
      advcl: 1,
      'aux:pass': 1,
      mark: 2,
      'nsubj:pass': 1,
      nsubj: 1,
      root: 1,
      xcomp: 1,
    },
  });
  assert.deepEqual(analysis.lexicalTokens, [
    { form: 'Although', lemma: 'although', upos: 'SCONJ' },
    { form: 'committee', lemma: 'committee', upos: 'NOUN' },
    { form: 'was', lemma: 'be', upos: 'AUX' },
    { form: 'to', lemma: 'to', upos: 'PART' },
    { form: 'formed', lemma: 'form', upos: 'VERB' },
    { form: 'review', lemma: 'review', upos: 'VERB' },
    { form: 'it', lemma: 'it', upos: 'PRON' },
    { form: 'decided', lemma: 'decide', upos: 'VERB' },
  ]);
});

test('the client adapter asks its worker for initialization, returns local unavailability, and never creates a fallback parse', async () => {
  const worker = new FakeWorker(message => {
    if (message.type === 'initialize') {
      worker.emit({
        type: 'ready',
        requestId: message.requestId,
        availability: createUnavailableGrammarAnalysis('MODEL_NOT_BUNDLED'),
      });
    }
  });
  const analyzer = new GrammarAnalyzer({ workerFactory: () => worker, manifestUrl: '/models/grammar-analyzer-manifest.json' });

  const result = await analyzer.analyze('A sentence that must not be regex-parsed.');

  assert.deepEqual(result, createUnavailableGrammarAnalysis('MODEL_NOT_BUNDLED'));
  assert.deepEqual(worker.sent, [{
    type: 'initialize',
    requestId: 1,
    manifestUrl: '/models/grammar-analyzer-manifest.json',
  }]);
  analyzer.dispose();
  assert.equal(worker.terminated, true);
});

test('the client analyzer rejects an already-aborted request before it starts a worker', async () => {
  let workerCalls = 0;
  const controller = new AbortController();
  controller.abort();
  const analyzer = new GrammarAnalyzer({
    workerFactory: () => {
      workerCalls += 1;
      const worker = new FakeWorker(message => {
        if (message.type === 'initialize') {
          worker.emit({
            type: 'ready',
            requestId: message.requestId,
            availability: { status: 'available', source: 'local' },
          });
        }
        if (message.type === 'analyze') {
          worker.emit({
            type: 'result',
            requestId: message.requestId,
            result: { status: 'available', source: 'local', metrics: { tokenCount: 1 } },
          });
        }
      });
      return worker;
    },
  });

  await assert.rejects(
    () => analyzer.analyze('A sentence.', { signal: controller.signal }),
    error => error?.name === 'AbortError',
  );
  assert.equal(workerCalls, 0);
});

test('the client analyzer aborts an in-flight parse, terminates the blocked worker, and ignores its late result', async () => {
  const worker = new FakeWorker(message => {
    if (message.type === 'initialize') {
      worker.emit({
        type: 'ready',
        requestId: message.requestId,
        availability: { status: 'available', source: 'local' },
      });
    }
    if (message.type === 'analyze') {
      setTimeout(() => {
        worker.emit({
          type: 'result',
          requestId: message.requestId,
          result: { status: 'available', source: 'local', metrics: { tokenCount: 1 } },
        });
      }, 5);
    }
  });
  const analyzer = new GrammarAnalyzer({ workerFactory: () => worker });
  const controller = new AbortController();
  const pending = analyzer.analyze('A parse that will be cancelled.', {
    signal: controller.signal,
    timeoutMs: 1_000,
  });

  await waitFor(() => worker.sent.some(message => message.type === 'analyze'));
  const requestId = worker.sent.find(message => message.type === 'analyze').requestId;
  controller.abort();

  await assert.rejects(pending, error => error?.name === 'AbortError');
  assert.equal(worker.terminated, true);
  worker.emit({
    type: 'result',
    requestId,
    result: { status: 'available', source: 'local', metrics: { tokenCount: 1 } },
  });
});

test('the client analyzer does not post when a signal aborts while its parse listener is attached', async () => {
  const worker = new FakeWorker(message => {
    if (message.type === 'initialize') {
      worker.emit({
        type: 'ready',
        requestId: message.requestId,
        availability: { status: 'available', source: 'local' },
      });
    }
    if (message.type === 'analyze') {
      worker.emit({
        type: 'result',
        requestId: message.requestId,
        result: { status: 'available', source: 'local', metrics: { tokenCount: 1 } },
      });
    }
  });
  const signal = {
    aborted: false,
    addCount: 0,
    addEventListener(_type, listener) {
      this.addCount += 1;
      if (this.addCount === 2) {
        this.aborted = true;
        listener();
      }
    },
    removeEventListener() {},
  };
  const analyzer = new GrammarAnalyzer({ workerFactory: () => worker });

  await assert.rejects(
    () => analyzer.analyze('A parse that aborts at registration.', { signal }),
    error => error?.name === 'AbortError',
  );
  assert.deepEqual(worker.sent.map(message => message.type), ['initialize']);
  assert.equal(worker.terminated, true);
});

test('the client analyzer returns a typed timeout result and rebuilds its worker for the next parse', async () => {
  const blockedWorker = new FakeWorker(message => {
    if (message.type === 'initialize') {
      blockedWorker.emit({
        type: 'ready',
        requestId: message.requestId,
        availability: { status: 'available', source: 'local' },
      });
    }
    if (message.type === 'analyze') {
      setTimeout(() => {
        blockedWorker.emit({
          type: 'result',
          requestId: message.requestId,
          result: { status: 'available', source: 'local', metrics: { tokenCount: 1 } },
        });
      }, 25);
    }
  });
  const recoveredWorker = new FakeWorker(message => {
    if (message.type === 'initialize') {
      recoveredWorker.emit({
        type: 'ready',
        requestId: message.requestId,
        availability: { status: 'available', source: 'local' },
      });
    }
    if (message.type === 'analyze') {
      recoveredWorker.emit({
        type: 'result',
        requestId: message.requestId,
        result: { status: 'available', source: 'local', metrics: { tokenCount: 3 } },
      });
    }
  });
  const workers = [blockedWorker, recoveredWorker];
  const analyzer = new GrammarAnalyzer({
    workerFactory: () => workers.shift(),
    analysisTimeoutMs: 10,
  });

  const timedOut = await analyzer.analyze('A parse that will time out.');

  assert.deepEqual(timedOut, createUnavailableGrammarAnalysis('ANALYSIS_TIMEOUT'));
  assert.equal(blockedWorker.terminated, true);
  assert.deepEqual(await analyzer.analyze('A parse after recovery.'), {
    status: 'available',
    source: 'local',
    metrics: { tokenCount: 3 },
  });
});

test('grammar profiles reject uncalibrated thresholds instead of using invented exam cutoffs', () => {
  const profile = createGrammarProfile({
    track: 'cet4',
    mode: 'benchmark',
    calibration: { status: 'pending-corpus-calibration' },
  });

  assert.deepEqual(validateGrammarProfile(profile), {
    status: 'unavailable',
    reason: 'PROFILE_NOT_CALIBRATED',
  });
});

test('grammar profiles accept a traceable corpus-calibrated feature range', () => {
  const profile = createGrammarProfile({
    track: 'kaoyan1',
    mode: 'stretch',
    calibration: {
      status: 'calibrated',
      corpusId: 'kaoyan1-reading-v1',
      corpusVersion: '2026.07',
      features: {
        maxDependencyDepth: { min: 2, max: 6 },
        clauseRelationCountPer100Tokens: { min: 4, max: 18 },
      },
    },
  });

  assert.deepEqual(validateGrammarProfile(profile), {
    status: 'available',
    track: 'kaoyan1',
    mode: 'stretch',
  });
});

test('the worker runtime refuses an unbundled model before it attempts any runtime import', async () => {
  let imported = false;
  const runtime = createGrammarWorkerRuntime({
    fetchImpl: async () => jsonResponse({
      ...eligibleManifest,
      model: { ...eligibleManifest.model, status: 'not-bundled', url: null },
    }),
    dynamicImport: async () => {
      imported = true;
      return {};
    },
  });

  const availability = await runtime.initialize('/models/grammar-analyzer-manifest.json');

  assert.deepEqual(availability, createUnavailableGrammarAnalysis('MODEL_NOT_BUNDLED'));
  assert.equal(imported, false);
  assert.deepEqual(await runtime.analyze('Do not invent a parse.'), availability);
});

test('the worker runtime requires the document-preserving parser contract before reporting local availability', async () => {
  const runtime = createGrammarWorkerRuntime({
    fetchImpl: async () => jsonResponse(eligibleManifest),
    dynamicImport: async () => ({
      loadParser: async () => ({ parse: () => ({ tokens: [] }) }),
    }),
  });

  assert.deepEqual(await runtime.initialize('/models/grammar-analyzer-manifest.json'), createUnavailableGrammarAnalysis('RUNTIME_CONTRACT_UNSUPPORTED'));
});

test('the worker runtime uses an injected bundled loader for a bundled module manifest and does not dynamically import a URL', async () => {
  let dynamicallyImported = false;
  const runtime = createGrammarWorkerRuntime({
    fetchImpl: async () => jsonResponse(bundledModuleManifest),
    dynamicImport: async () => {
      dynamicallyImported = true;
      throw new Error('must not import a URL');
    },
    loadBundledParser: async () => ({
      parseDocument: async () => ({ sentences: [] }),
    }),
  });

  const availability = await runtime.initialize('/models/grammar-analyzer-manifest.json');

  assert.equal(availability.status, 'available');
  assert.equal(dynamicallyImported, false);
});

test('the worker runtime returns metrics only from a parser-supplied dependency document', async () => {
  const runtime = createGrammarWorkerRuntime({
    fetchImpl: async () => jsonResponse(eligibleManifest),
    dynamicImport: async () => ({
      loadParser: async () => ({
        parseDocument: async () => ({
          sentences: [{ tokens: [{ id: 1, head: 0, deprel: 'root' }] }],
        }),
      }),
    }),
  });

  assert.equal((await runtime.initialize('/models/grammar-analyzer-manifest.json')).status, 'available');
  assert.deepEqual(await runtime.analyze('A real parser document.'), {
    status: 'available',
    source: 'local',
    lexicalTokens: null,
    metrics: {
      sentenceCount: 1,
      tokenCount: 1,
      clauseRelationCount: 0,
      passivePredicateCount: 0,
      nonFiniteRelationCount: 0,
      maxDependencyDepth: 1,
      relations: { root: 1 },
    },
  });
});

test('the UDPipe adapter uses a real parser once per Intl.Segmenter sentence and preserves sentence boundaries', async () => {
  const calls = [];
  const loader = createUdpipeDocumentLoader({
    loadParser: async options => {
      assert.deepEqual(options, { modelUrl: '/models/english.udpipe', wasmUrl: '/assets/udpipe.wasm' });
      return {
        parse: text => {
          calls.push(text);
          return { tokens: [{ id: 1, head: 0, deprel: 'root', form: text }] };
        },
      };
    },
    segmenter: {
      segment: () => [
        { segment: 'First sentence. ' },
        { segment: 'Second sentence.' },
      ],
    },
  });

  const parser = await loader.loadParser({ modelUrl: '/models/english.udpipe', wasmUrl: '/assets/udpipe.wasm' });
  const document = await parser.parseDocument('First sentence. Second sentence.');

  assert.deepEqual(calls, ['First sentence.', 'Second sentence.']);
  assert.equal(document.sentences.length, 2);
  assert.deepEqual(document.sentences.map(sentence => sentence.tokens[0].form), ['First sentence.', 'Second sentence.']);
});

test('the UDPipe adapter refuses to turn a raw or malformed parse into a grammar document', async () => {
  const loader = createUdpipeDocumentLoader({
    loadParser: async () => ({ parse: () => ({}) }),
    segmenter: { segment: () => [{ segment: 'Sentence.' }] },
  });
  const parser = await loader.loadParser({ modelUrl: '/models/english.udpipe', wasmUrl: '/assets/udpipe.wasm' });

  await assert.rejects(() => parser.parseDocument('Sentence.'), /UDPipe parser returned no dependency tokens/);
});

test('the production UDPipe loader pins the browser package entry and lets Vite emit its wasm asset', async () => {
  const source = await readFile(new URL('../src/workers/grammar-udpipe-runtime-loader.mjs', import.meta.url), 'utf8');

  assert.match(source, /from 'udpipe-wasm'/);
  assert.match(source, /from 'udpipe-wasm\/udpipe\.wasm\?url'/);
  assert.match(source, /createUdpipeDocumentLoader/);
});

test('the shipping parser manifest identifies the exact bundled-module contract and checksum-verified offline model', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/models/grammar-analyzer-manifest.json', import.meta.url), 'utf8'));
  const modelUrl = new URL('../public/models/grammar/english-ud-2.1-20180111.udpipe', import.meta.url);
  const [model, metadata] = await Promise.all([readFile(modelUrl), stat(modelUrl)]);

  assert.equal(manifest.runtime.moduleId, 'udpipe-wasm-v1');
  assert.equal(manifest.runtime.status, 'bundled');
  assert.equal(manifest.model.status, 'bundled');
  assert.equal(manifest.model.url, '/models/grammar/english-ud-2.1-20180111.udpipe');
  assert.equal(manifest.model.sourceBytes, 16368326);
  assert.equal(metadata.size, manifest.model.sourceBytes);
  assert.equal(createHash('sha256').update(model).digest('hex').toUpperCase(), manifest.model.sha256);
});

class FakeWorker {
  constructor(onPostMessage) {
    this.onPostMessage = onPostMessage;
    this.listeners = new Map();
    this.sent = [];
    this.terminated = false;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type) {
    this.listeners.delete(type);
  }

  postMessage(message) {
    this.sent.push(message);
    this.onPostMessage(message);
  }

  emit(data) {
    this.listeners.get('message')?.({ data });
  }

  terminate() {
    this.terminated = true;
  }
}

function jsonResponse(body) {
  return {
    ok: true,
    json: async () => body,
  };
}

async function waitFor(predicate, { timeoutMs = 100, intervalMs = 1 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for test condition');
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
