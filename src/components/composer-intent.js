const EXPLANATION_PATTERNS = [
  /^(?:怎么|如何|为什么|能否|能不能|可以吗|是否|想知道).{0,28}(?:生成|写|阅读)/,
  /(?:生成|写|阅读).{0,18}(?:怎么|如何|为什么|吗|？)$/
];

const ARTICLE_REQUEST_PATTERNS = [
  /(?:请|帮我|给我|想要|来|写|生成|做|出).{0,18}(?:一篇|文章|阅读|英文|英语)/,
  /(?:生成|写|来|出).{0,8}(?:一篇|文章|阅读)/
];

export function classifyComposerIntent(message) {
  const text = String(message || '').trim();
  if (!text || EXPLANATION_PATTERNS.some(pattern => pattern.test(text))) return 'chat';
  return ARTICLE_REQUEST_PATTERNS.some(pattern => pattern.test(text)) ? 'generate' : 'chat';
}
