export function createUdpipeDocumentLoader({ loadParser, segmenter = createSentenceSegmenter() } = {}) {
  if (typeof loadParser !== 'function') throw new TypeError('UDPipe loadParser must be a function');

  return {
    async loadParser({ modelUrl, wasmUrl } = {}) {
      if (!segmenter || typeof segmenter.segment !== 'function') {
        throw new Error('Intl.Segmenter is unavailable for UDPipe document parsing');
      }
      const rawParser = await loadParser({ modelUrl, wasmUrl });
      if (!rawParser || typeof rawParser.parse !== 'function') {
        throw new Error('UDPipe parser contract is unsupported');
      }

      return {
        async parseDocument(text) {
          const sentences = getSentenceSegments(text, segmenter);
          return {
            sentences: sentences.map(sentenceText => {
              const tree = rawParser.parse(sentenceText);
              if (!Array.isArray(tree?.tokens)) {
                throw new Error('UDPipe parser returned no dependency tokens');
              }
              return { tokens: tree.tokens };
            }),
          };
        },
      };
    },
  };
}

function createSentenceSegmenter() {
  if (typeof Intl?.Segmenter !== 'function') return null;
  return new Intl.Segmenter('en', { granularity: 'sentence' });
}

function getSentenceSegments(text, segmenter) {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText) return [];
  return [...segmenter.segment(normalizedText)]
    .map(part => String(part.segment || '').trim())
    .filter(Boolean);
}
