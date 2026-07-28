import { createGrammarWorkerRuntime } from './grammar-analyzer-runtime.mjs';
import { loadParser as loadBundledParser } from './grammar-udpipe-runtime-loader.mjs';

const runtime = createGrammarWorkerRuntime({ loadBundledParser });

globalThis.addEventListener('message', event => {
  const message = event?.data || {};
  if (message.type === 'initialize') {
    runtime.initialize(message.manifestUrl).then(availability => postMessage({ type: 'ready', requestId: message.requestId, availability }));
    return;
  }
  if (message.type === 'analyze') {
    runtime.analyze(message.text).then(result => postMessage({ type: 'result', requestId: message.requestId, result }));
  }
});
