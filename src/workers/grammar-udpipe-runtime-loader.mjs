import { loadParser as loadUDPipe } from 'udpipe-wasm';
import bundledWasmUrl from 'udpipe-wasm/udpipe.wasm?url';
import { createUdpipeDocumentLoader } from './grammar-udpipe-adapter.mjs';

const documentLoader = createUdpipeDocumentLoader({ loadParser: loadUDPipe });

export function loadParser({ modelUrl } = {}) {
  return documentLoader.loadParser({
    modelUrl,
    // Vite owns the emitted file name. Never trust a copied manifest URL here
    // or the worker could request a stale hashed asset after an app update.
    wasmUrl: bundledWasmUrl,
  });
}
