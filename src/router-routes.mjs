/**
 * Route definitions for the application shell.
 *
 * The loader functions intentionally use explicit dynamic imports so Vite can
 * split each page into its own chunk while keeping route matching testable in
 * Node without importing the browser-only view modules.
 */

const noArgs = () => [];

// Parameter hashes may carry a query part; decoding happens after the query
// is removed, and a malformed escape degrades to the raw segment instead of
// breaking the whole router.
const stripQuery = hash => String(hash || '').split('?')[0];
const safeDecode = value => {
  const raw = String(value ?? '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const route = ({
  routeKey,
  exportName,
  match,
  getArgs = noArgs,
  load,
  cachePolicy = 'dispose'
}) => {
  let modulePromise = null;
  let dataPromise = null;
  const loadOnce = () => {
    if (!modulePromise) {
      modulePromise = Promise.resolve()
        .then(load)
        .catch(error => {
          modulePromise = null;
          throw error;
        });
    }
    return modulePromise;
  };
  const preloadData = () => {
    if (!dataPromise) {
      dataPromise = loadOnce()
        .then(module => {
          const view = module?.[exportName] || module?.default;
          return view?.preloadData?.();
        })
        .catch(error => {
          dataPromise = null;
          throw error;
        });
    }
    return dataPromise;
  };
  return Object.freeze({
    routeKey,
    exportName,
    match,
    getArgs,
    cachePolicy,
    load: loadOnce,
    warmup: loadOnce,
    preloadData
  });
};

// Missing or empty ids must not reach a business view; they render an
// explicit, recoverable shell instead of falling through to the chat route.
const NotFoundView = {
  async render(outlet) {
    if (!outlet) return;
    outlet.innerHTML = '<section class="app-standard-page route-not-found"><p class="page-eyebrow">NOT FOUND</p><h2>页面不存在</h2><p>链接缺少参数或已失效，请返回后重试。</p><a class="btn btn-primary" href="#/chat">返回首页</a></section>';
  }
};

const notFoundLoad = () => Promise.resolve({ NotFoundView });

const chatRoute = route({
  routeKey: 'chat',
  exportName: 'ChatView',
  match: hash => hash === '#/chat',
  load: () => import('./views/chat.js')
});

export const ROUTES = Object.freeze([
  chatRoute,
  route({
    routeKey: 'reading',
    exportName: 'ReadingView',
    match: hash => /^#\/reading\/\d+$/.test(hash),
    getArgs: hash => [Number.parseInt(stripQuery(hash).split('/')[2], 10)],
    load: () => import('./views/reading.js')
  }),
  route({
    routeKey: 'history',
    exportName: 'HistoryView',
    match: hash => hash === '#/history',
    cachePolicy: 'keep-alive',
    load: () => import('./views/history.js')
  }),
  route({
    routeKey: 'vocabulary',
    exportName: 'VocabularyView',
    match: hash => hash === '#/vocab',
    cachePolicy: 'keep-alive',
    load: () => import('./views/vocabulary.js')
  }),
  route({
    routeKey: 'review-mode',
    exportName: 'ReviewModeView',
    match: hash => hash === '#/flashcard',
    load: () => import('./views/review-mode.js')
  }),
  route({
    routeKey: 'flashcard',
    exportName: 'FlashcardView',
    match: hash => hash === '#/flashcard/recall' || /^#\/flashcard\/practice\/[a-z_]+$/.test(hash),
    getArgs: hash => hash.startsWith('#/flashcard/practice/') ? [hash.split('/').pop()] : [],
    load: () => import('./views/flashcard.js')
  }),
  route({
    routeKey: 'context-review',
    exportName: 'ContextReviewView',
    match: hash => hash === '#/flashcard/context',
    load: () => import('./views/context-review.js')
  }),
  route({
    routeKey: 'settings',
    exportName: 'SettingsView',
    match: hash => hash === '#/settings',
    load: () => import('./views/settings.js')
  }),
  route({
    // #/stats is a legacy alias of #/profile. Both hashes must share the same
    // cache identity because they render the same singleton StatsView.
    routeKey: 'profile',
    exportName: 'StatsView',
    match: hash => hash === '#/stats',
    cachePolicy: 'keep-alive',
    load: () => import('./views/stats.js')
  }),
  route({
    routeKey: 'report',
    exportName: 'ReportView',
    match: hash => hash === '#/report',
    load: () => import('./views/report.js')
  }),
  route({
    routeKey: 'calibration',
    exportName: 'CalibrationView',
    match: hash => hash === '#/assessment',
    load: () => import('./views/calibration.js')
  }),
  route({
    routeKey: 'reading-list',
    exportName: 'ReadingListView',
    match: hash => hash === '#/reading-list',
    cachePolicy: 'keep-alive',
    load: () => import('./views/reading-list.js')
  }),
  route({
    routeKey: 'not-found',
    exportName: 'NotFoundView',
    match: hash => /^#\/reading\/?$/.test(hash),
    load: notFoundLoad
  }),
  route({
    routeKey: 'profile',
    exportName: 'StatsView',
    match: hash => hash === '#/profile',
    cachePolicy: 'keep-alive',
    load: () => import('./views/stats.js')
  })
]);

export function resolveRoute(hash = '#/chat') {
  const path = stripQuery(hash) || '#/chat';
  const definition = ROUTES.find(item => item.match(path)) || chatRoute;
  return {
    ...definition,
    args: definition.getArgs(path)
  };
}

export function preloadRoute(hash = '#/chat') {
  return resolveRoute(hash).preloadData();
}

const CORE_WARM_ROUTES = Object.freeze([
  '#/history',
  '#/vocab',
  '#/reading-list',
  '#/flashcard',
  '#/profile'
]);

function defaultIdleSchedule(callback) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    return globalThis.requestIdleCallback(callback, { timeout: 1500 });
  }
  return globalThis.setTimeout(callback, 0);
}

export async function warmCoreRoutes({ schedule = defaultIdleSchedule, preload = preloadRoute } = {}) {
  for (const hash of CORE_WARM_ROUTES) {
    await new Promise(resolve => {
      schedule(() => {
        void preload(hash).catch(() => undefined).finally(resolve);
      });
    });
  }
}
