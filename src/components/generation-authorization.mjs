const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();

const NON_GENERATION_REQUEST = /(?:怎么|如何|为什么|什么类型|解释|翻译|分析|修改|润色|批改|校对|大纲|概括|总结|比较|是否|吗|？|\?)/;
const EXPLICIT_GENERATION_REQUEST = [
  /(?:请|帮我|给我|麻烦)?(?:生成|写|撰写|定制|制作|做|出).{0,72}(?:阅读|文章|短文|练习|passage|article|essay)/i,
  /(?:给我|帮我|来|再来|继续来|出).{0,24}(?:一篇|篇).{0,52}(?:阅读|文章|短文|练习|passage|article|essay)/i,
  /(?:我想|我想要|想要|想读|想看).{0,24}(?:一篇|篇).{0,52}(?:阅读|文章|短文|练习|passage|article|essay)/i,
  /(?:根据|结合).{0,60}(?:薄弱|词库|学习情况|复习|掌握).{0,60}(?:生成|来|出|给我|一篇|阅读|练习)/i,
  /(?:来|再来|继续).{0,16}(?:一篇|阅读|文章|短文|练习)/i
];

/**
 * A deterministic write guard, not an intent router. The model remains free
 * to decide when to call the tool; this only prevents an unexpected tool call
 * from turning a question about an existing article into a new saved article.
 */
export function isGenerationAuthorized(message) {
  const text = normalize(message);
  if (!text || NON_GENERATION_REQUEST.test(text)) return false;
  return EXPLICIT_GENERATION_REQUEST.some(pattern => pattern.test(text));
}
