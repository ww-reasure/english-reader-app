const EXPLANATION_PATTERNS = [
  /^(?:怎么|如何|为什么|想知道).{0,28}(?:生成|写|阅读)/,
  /(?:生成|写|阅读).{0,18}(?:怎么|如何|为什么|吗|？)$/,
  /^(?:how|why|what)\b.{0,80}\b(?:generate|write|create|article|reading|passage|essay)\b/i
];

const ARTICLE_REQUEST_PATTERNS = [
  /(?:请|帮我|给我|想要|来|写|生成|做|出|想读|想看).{0,28}(?:一篇|文章|阅读|英文|英语)/,
  /我想(?:读|看).{0,18}(?:一篇).{0,18}(?:文章|阅读)/,
  /(?:生成|写|来|出).{0,12}(?:一篇|文章|阅读)/,
  /\b(?:please\s+)?(?:generate|write|create|make)\b.{0,96}\b(?:english\s+)?(?:article|reading|passage|essay)\b/i,
  /\b(?:give me|i(?:'d| would) like|i want|let me)\b.{0,96}\b(?:english\s+)?(?:article|reading|passage|essay)\b/i
];

export function classifyComposerIntent(message) {
  const text = String(message || '').trim();
  if (!text || EXPLANATION_PATTERNS.some(pattern => pattern.test(text))) return 'chat';
  return ARTICLE_REQUEST_PATTERNS.some(pattern => pattern.test(text)) ? 'generate' : 'chat';
}
