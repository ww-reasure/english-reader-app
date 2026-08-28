/**
 * Small, DOM-independent helpers for trimming the home conversation at runtime.
 * Persistent message wrappers opt in with data-home-message-id; transient UI
 * such as thinking and generation previews deliberately has no identity.
 */

const asMessageId = value => String(value || '').trim();

const nodeMessageId = node => asMessageId(
  node?.dataset?.homeMessageId
  || node?.getAttribute?.('data-home-message-id')
  || ''
);

export const collectImageObjectUrls = node => {
  const urls = new Set();
  const images = node?.querySelectorAll?.('img[src]') || [];
  for (const image of images) {
    const url = asMessageId(image?.currentSrc || image?.getAttribute?.('src') || image?.src || '');
    if (url) urls.add(url);
  }
  return urls;
};

/**
 * Remove only persistent message nodes whose identities are no longer in the
 * Store snapshot. Nodes without an identity are transient and are untouched.
 */
export const compactPersistentHomeMessageNodes = ({
  nodes = [],
  retainedMessageIds = [],
  onRemove = () => {}
} = {}) => {
  const retained = new Set([...retainedMessageIds].map(asMessageId).filter(Boolean));
  const removed = [];
  for (const node of nodes || []) {
    const messageId = nodeMessageId(node);
    if (!messageId || retained.has(messageId)) continue;
    removed.push({ node, messageId });
    node?.remove?.();
    onRemove(node, messageId);
  }
  return removed;
};

/**
 * Release only historical image previews belonging to a removed message.
 * Draft URLs use different keys and are intentionally protected here. A URL
 * still referenced by another visible card is also kept for that card.
 */
export const releaseRemovedImageObjectUrls = ({
  urlMap,
  urls = [],
  stillUsedUrls = [],
  revoke = url => globalThis.URL?.revokeObjectURL?.(url)
} = {}) => {
  if (!urlMap || typeof urlMap.entries !== 'function') return [];
  const removedUrls = new Set([...urls].map(asMessageId).filter(Boolean));
  const usedElsewhere = new Set([...stillUsedUrls].map(asMessageId).filter(Boolean));
  const revoked = [];
  for (const [key, url] of [...urlMap.entries()]) {
    const normalizedKey = String(key || '');
    const normalizedUrl = asMessageId(url);
    if (!normalizedKey.startsWith('history:') || !removedUrls.has(normalizedUrl) || usedElsewhere.has(normalizedUrl)) continue;
    try { revoke(normalizedUrl); } catch {}
    urlMap.delete(key);
    revoked.push(normalizedUrl);
  }
  return revoked;
};
