import {
  analyzeDependencyDocument,
  createUnavailableGrammarAnalysis,
  validateLocalGrammarManifest,
} from '../components/grammar-analyzer-contract.mjs';

export function createGrammarWorkerRuntime({ fetchImpl = globalThis.fetch?.bind(globalThis), dynamicImport = importRuntimeModule, loadBundledParser = null } = {}) {
  let parser = null;
  let availability = createUnavailableGrammarAnalysis('LOCAL_RUNTIME_UNAVAILABLE');

  return {
    async initialize(manifestUrl) {
      parser = null;
      availability = createUnavailableGrammarAnalysis('LOCAL_RUNTIME_UNAVAILABLE');
      if (typeof fetchImpl !== 'function') {
        availability = createUnavailableGrammarAnalysis('FETCH_UNSUPPORTED');
        return availability;
      }

      try {
        const response = await fetchImpl(manifestUrl, { cache: 'no-store' });
        if (!response?.ok) {
          availability = createUnavailableGrammarAnalysis('MANIFEST_FETCH_FAILED');
          return availability;
        }
        const manifest = await response.json();
        const eligibility = validateLocalGrammarManifest(manifest);
        if (eligibility.status !== 'eligible') {
          availability = eligibility;
          return availability;
        }

        const loadParser = await getParserLoader(manifest.runtime, dynamicImport, loadBundledParser);
        if (typeof loadParser !== 'function') {
          availability = createUnavailableGrammarAnalysis('RUNTIME_CONTRACT_UNSUPPORTED');
          return availability;
        }
        const loadedParser = await loadParser({ modelUrl: manifest.model.url, wasmUrl: manifest.runtime.wasmUrl });
        if (!loadedParser || typeof loadedParser.parseDocument !== 'function') {
          availability = createUnavailableGrammarAnalysis('RUNTIME_CONTRACT_UNSUPPORTED');
          return availability;
        }

        parser = loadedParser;
        availability = {
          status: 'available',
          source: 'local',
          runtimeId: manifest.runtime.id,
          modelId: manifest.model.id,
        };
        return availability;
      } catch {
        availability = createUnavailableGrammarAnalysis('LOCAL_RUNTIME_LOAD_FAILED');
        return availability;
      }
    },

    async analyze(text) {
      if (!parser || availability.status !== 'available') return availability;
      if (typeof text !== 'string' || !text.trim()) return createUnavailableGrammarAnalysis('EMPTY_TEXT');
      try {
        const document = await parser.parseDocument(text);
        return analyzeDependencyDocument(document);
      } catch {
        return createUnavailableGrammarAnalysis('LOCAL_PARSE_FAILED');
      }
    },

    getAvailability() {
      return availability;
    },
  };
}

async function getParserLoader(runtime, dynamicImport, loadBundledParser) {
  if (runtime.moduleId) return typeof loadBundledParser === 'function' ? loadBundledParser : null;
  const module = await dynamicImport(runtime.loaderUrl);
  return module?.loadParser;
}

function importRuntimeModule(url) {
  return import(/* @vite-ignore */ url);
}
