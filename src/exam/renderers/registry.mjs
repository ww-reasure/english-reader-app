import { clozeRenderer } from './cloze-renderer.mjs';
import { paragraphOrderingRenderer } from './paragraph-ordering-renderer.mjs';
import { readingMcqRenderer } from './reading-mcq-renderer.mjs';
import { translationRenderer } from './translation-renderer.mjs';
import { matchingRenderer } from './matching-renderer.mjs';

const renderers = new Map([
  [readingMcqRenderer.unitType, readingMcqRenderer],
  [clozeRenderer.unitType, clozeRenderer],
  [paragraphOrderingRenderer.unitType, paragraphOrderingRenderer],
  [matchingRenderer.unitType, matchingRenderer],
  [translationRenderer.unitType, translationRenderer]
]);

export function getExamRenderer(unitType) {
  const renderer = renderers.get(unitType);
  if (!renderer) throw new Error(`未注册题型 renderer：${unitType}`);
  return renderer;
}
