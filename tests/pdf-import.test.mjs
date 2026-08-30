import assert from 'node:assert/strict';
import test from 'node:test';

import { createPdfImportService } from '../src/pdf-import.mjs';

const never = () => new Promise(() => {});
const file = (bytes = new Uint8Array([1, 2, 3])) => ({
  arrayBuffer: async () => bytes.buffer
});

test('PDF parser loading has a bounded timeout and reports the loader phase', async () => {
  const service = createPdfImportService({
    loadPdfJs: never,
    timeouts: { loaderMs: 20, totalMs: 100 }
  });

  await assert.rejects(
    service.extractText(file()),
    error => error?.code === 'timeout' && error.phase === 'loader' && /解析器/.test(error.message)
  );
});

test('PDF document loading is bounded and destroys the pending loading task', async () => {
  let destroyed = false;
  const service = createPdfImportService({
    loadPdfJs: async () => ({
      getDocument() {
        return {
          promise: never(),
          destroy() {
            destroyed = true;
          }
        };
      }
    }),
    timeouts: { documentMs: 20, totalMs: 100 }
  });

  await assert.rejects(
    service.extractText(file()),
    error => error?.code === 'timeout' && error.phase === 'document'
  );
  assert.equal(destroyed, true);
});

test('PDF page extraction reports progress and rejects a stuck page', async () => {
  const progress = [];
  const service = createPdfImportService({
    loadPdfJs: async () => ({
      getDocument() {
        return {
          promise: Promise.resolve({
            numPages: 1,
            getPage: async () => ({
              getTextContent: never,
              cleanup() {}
            }),
            destroy() {}
          })
        };
      }
    }),
    timeouts: { pageMs: 20, totalMs: 100 },
    onProgress: event => progress.push(event)
  });

  await assert.rejects(
    service.extractText(file()),
    error => error?.code === 'timeout' && error.phase === 'page_text'
  );
  assert.ok(progress.some(event => event.phase === 'document'));
  assert.ok(progress.some(event => event.phase === 'page_text' && event.page === 1));
});

test('concurrent PDF imports share one parser load', async () => {
  let loadCalls = 0;
  let resolveParser;
  const parserPromise = new Promise(resolve => { resolveParser = resolve; });
  const parser = {
    getDocument() {
      return {
        promise: Promise.resolve({ numPages: 0, destroy() {} })
      };
    }
  };
  const service = createPdfImportService({
    loadPdfJs: async () => {
      loadCalls += 1;
      return parserPromise;
    },
    timeouts: { loaderMs: 100, totalMs: 500 }
  });

  const first = service.extractText(file());
  const second = service.extractText(file());
  resolveParser(parser);

  await Promise.all([first, second]);
  assert.equal(loadCalls, 1);
});

test('extracts text from every PDF page and preserves page progress metadata', async () => {
  const progress = [];
  const service = createPdfImportService({
    loadPdfJs: async () => ({
      getDocument() {
        return {
          promise: Promise.resolve({
            numPages: 2,
            getPage: async pageNumber => ({
              getTextContent: async () => ({ items: [{ str: pageNumber === 1 ? 'first' : 'second' }] }),
              cleanup() {}
            }),
            destroy() {}
          })
        };
      }
    }),
    onProgress: event => progress.push(event),
    timeouts: { totalMs: 500 }
  });

  assert.equal(await service.extractText(file()), 'first\nsecond\n');
  assert.deepEqual(
    progress.filter(event => event.phase === 'page_text').map(event => [event.page, event.totalPages]),
    [[1, 2], [2, 2]]
  );
});

test('falls back to main-thread parsing when the PDF worker cannot start', async () => {
  const options = [];
  const service = createPdfImportService({
    loadPdfJs: async () => ({
      getDocument(request) {
        options.push(request);
        if (options.length === 1) {
          return {
            promise: Promise.reject(new Error('Setting up fake worker failed')),
            destroy() {}
          };
        }
        return {
          promise: Promise.resolve({
            numPages: 0,
            destroy() {}
          })
        };
      }
    }),
    timeouts: { documentMs: 100, totalMs: 500 }
  });

  await service.extractText(file());
  assert.equal(options.length, 2);
  assert.equal(options[1].disableWorker, true);
});
