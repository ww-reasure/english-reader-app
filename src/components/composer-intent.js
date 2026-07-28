const EXPLANATION_PATTERNS = [
  /^(?:怎么|如何|为什么|想知道).{0,28}(?:生成|写|阅读)/,
  /(?:生成|写|阅读).{0,18}(?:怎么|如何|为什么|吗|？)$/,
  /^(?:(?:请|麻烦|能否|可以)?(?:帮我|给我)?|(?:我想|我想要|想要))?(?:解释|翻译|分析|修改|批改|润色|校对|概括|总结|比较|了解|知道|学习|讨论|评价)/,
  /(?:解释|翻译|分析).{0,48}(?:文章|阅读|词汇|语法)/,
  /^(?:how|why|what)\b.{0,80}\b(?:generate|write|create|article|reading|passage|essay)\b/i,
  /^(?:i\s+(?:want|would\s+like)\s+to\s+know|can\s+you\s+explain|could\s+you\s+explain)\b.{0,80}\b(?:how|why|what|generate|write|create|article|reading|passage|essay)\b/i
];

const ARTICLE_REQUEST_PATTERNS = [
  /^(?:(?:请|帮我|我想要|想要)\s*)?(?:给我|来|生成|写|撰写|定制|制作|做|出|想读|想看)\s*.{0,28}(?:一篇|文章|阅读)/,
  /我想(?:读|看).{0,18}(?:一篇).{0,18}(?:文章|阅读)/,
  /^(?:请\s*)?(?:生成|写|来|出).{0,12}(?:一篇|文章|阅读)/,
  /^(?:please\s+)?(?:generate|write|create|make)\b.{0,96}\b(?:english\s+)?(?:article|reading|passage|essay)\b/i,
  /^(?:give me|i(?:'d| would) like|i want|let me)\b.{0,96}\b(?:english\s+)?(?:article|reading|passage|essay)\b/i
];

export function classifyComposerIntent(message) {
  const text = String(message || '').trim();
  if (!text || EXPLANATION_PATTERNS.some(pattern => pattern.test(text))) return 'chat';
  return ARTICLE_REQUEST_PATTERNS.some(pattern => pattern.test(text)) ? 'generate' : 'chat';
}
