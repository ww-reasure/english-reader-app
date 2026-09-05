/**
 * Browser-independent navigation lifecycle for the hash router.
 *
 * It deliberately separates shell mounting from view cleanup/rendering. Page
 * cleanup may flush IndexedDB asynchronously, but a new shell can still be
 * shown immediately and stale route work is ignored by the navigation token.
 */

const noop = () => {};

export const ROUTE_RENDER_ERROR_HTML = '<section class="app-standard-page route-render-error"><p class="page-eyebrow">TEMPORARY ERROR</p><h2>页面暂时无法打开</h2><p>请返回后重试；已有学习记录不会丢失。</p><a class="btn btn-primary" href="#/chat">返回首页</a></section>';

export function renderRouteError(outlet) {
  if (!outlet) return;
  outlet.innerHTML = ROUTE_RENDER_ERROR_HTML;
}

function asPromise(value) {
  return value && typeof value.then === 'function' ? value : Promise.resolve(value);
}

/**
 * @param {object} options
 * @param {object} options.appShell Shell adapter exposing cleanup() and mount().
 * @param {object} [options.wordStudyDetail] Optional transient detail adapter.
 * @param {Function} options.getApp Returns the app root element.
 * @param {Function} options.getRouteMeta Resolves shell metadata for a hash.
 * @param {Function} options.resolveRoute Resolves a hash to a lazy route.
 * @param {Function} [options.onCleanupError] Receives a rejected view cleanup.
 * @param {Function} [options.onRenderError] Receives a route render/load error.
 * @param {object|null} [options.initialView] Existing view to clean on first navigation.
 */
export function createNavigationController({
  appShell,
  wordStudyDetail = null,
  getApp,
  getRouteMeta,
  resolveRoute,
  onCleanupError = noop,
  onRenderError = noop,
  initialView = null,
  recordEvent = null,
  pendingRenderTracker = new WeakMap(),
  maxCachedRoutes = 3,
  performanceTimeline = globalThis.performance,
  onFirstMeaningfulPaint = noop,
  afterPaint = callback => {
    const frame = globalThis.requestAnimationFrame || (next => globalThis.setTimeout(next, 0));
    frame(() => frame(callback));
  },
  now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now())
} = {}) {
  const state = {
    currentView: initialView,
    navigationToken: 0,
    activeEntry: initialView ? { view: initialView, routeKey: '', cachePolicy: 'dispose', outlet: null } : null,
    pendingEntry: null
  };
  const pendingCleanups = new Map();
  // Singleton views can be rendered again while an older render of the same
  // view is still in flight. Same-view renders are serialized by the
  // controller (see pendingRenders below) so a superseded render can never
  // run concurrently with — and later overwrite — the live generation. The
  // business argument list of view.render stays untouched.
  const pendingRenders = pendingRenderTracker;
  const cachedRoutes = new Map();

  const isCurrent = token => token === state.navigationToken;

  // Stage evidence for the four navigation phases. Payloads carry only the
  // route key, correlation id, token, durations, and outcome — never the raw
  // hash, article ids, or query strings.
  const emitStage = (event, payload) => {
    try {
      const correlationId = String(payload?.correlationId || 'navigation');
      const prefix = `english-reader:${correlationId}`;
      const markName = `${prefix}:${event}`;
      performanceTimeline?.mark?.(markName);
      if (event !== 'route_started') {
        const measureName = `english-reader:route:${event
          .replace(/^route_/, '')
          .replaceAll('_', '-')}`;
        performanceTimeline?.measure?.(measureName, `${prefix}:route_started`, markName);
      }
    } catch {
      // User Timing is optional on old WebViews and must stay diagnostic-only.
    }
    try {
      recordEvent?.(event, payload);
    } catch {
      // Diagnostics must never break a navigation.
    }
    if (event === 'route_first_meaningful_paint') {
      try {
        onFirstMeaningfulPaint(payload);
      } catch {
        // Native startup reporting is also diagnostic-only.
      }
    }
  };

  function reportCleanupError(error) {
    try {
      onCleanupError(error);
    } catch {
      // Diagnostics must never break a subsequent navigation.
    }
  }

  function scheduleViewCleanup(view) {
    if (!view || typeof view.cleanup !== 'function') return Promise.resolve();

    const prior = pendingCleanups.get(view);
    const invoke = () => view.cleanup();
    let cleanupResult;
    if (prior) {
      // A singleton view may be revisited before its previous async cleanup
      // settles. Keep its cleanup operations in order without blocking shell
      // mounting for the new route.
      cleanupResult = prior.catch(() => undefined).then(invoke);
    } else {
      try {
        // Invoke immediately so synchronous listener teardown happens before
        // the new shell is mounted; any async persistence continues below.
        cleanupResult = invoke();
      } catch (error) {
        cleanupResult = Promise.reject(error);
      }
    }

    const tracked = asPromise(cleanupResult).finally(() => {
      if (pendingCleanups.get(view) === tracked) pendingCleanups.delete(view);
    });
    pendingCleanups.set(view, tracked);
    void tracked.catch(reportCleanupError);
    return tracked;
  }

  function cleanupCurrentView() {
    const previousView = state.activeEntry?.view || state.currentView;
    state.currentView = null;
    state.activeEntry = null;
    state.pendingEntry = null;

    try {
      wordStudyDetail?.close?.();
    } catch (error) {
      reportCleanupError(error);
    }
    try {
      // Detach shell listeners synchronously. This is intentionally before
      // waiting for a view's async persistence cleanup.
      appShell?.cleanup?.();
    } catch (error) {
      reportCleanupError(error);
    }

    return scheduleViewCleanup(previousView);
  }

  function scheduleViewDisposal(view) {
    if (!view) return Promise.resolve();
    if (typeof view.dispose !== 'function') return scheduleViewCleanup(view);
    let result;
    try {
      result = view.dispose();
    } catch (error) {
      result = Promise.reject(error);
    }
    const tracked = asPromise(result);
    void tracked.catch(reportCleanupError);
    return tracked;
  }

  function rememberCachedEntry(entry) {
    if (!entry || entry.cachePolicy !== 'keep-alive') return;
    cachedRoutes.delete(entry.routeKey);
    cachedRoutes.set(entry.routeKey, entry);
    while (cachedRoutes.size > Math.max(1, Number(maxCachedRoutes) || 3)) {
      const candidate = [...cachedRoutes.entries()].find(([, value]) => value !== state.activeEntry && value !== entry);
      if (!candidate) break;
      const [routeKey, evicted] = candidate;
      cachedRoutes.delete(routeKey);
      appShell?.releaseRoute?.(routeKey, evicted.outlet);
      void scheduleViewDisposal(evicted.view);
    }
  }

  function abandonPendingEntry() {
    const pending = state.pendingEntry;
    if (!pending) return;
    pending.abandoned = true;
    state.pendingEntry = null;
    state.currentView = state.activeEntry?.view || null;
    try {
      wordStudyDetail?.close?.();
    } catch (error) {
      reportCleanupError(error);
    }
    // Tear down effects that were already bound synchronously. The tracked
    // render performs one compensating teardown after its late work settles.
    void scheduleViewCleanup(pending.view);
    appShell?.abortRoute?.(pending.outlet, { routeKey: pending.routeKey });
  }

  function leavePreviousEntry(previous, next) {
    if (!previous || previous === next) return;
    try {
      wordStudyDetail?.close?.();
    } catch (error) {
      reportCleanupError(error);
    }
    if (previous.cachePolicy === 'keep-alive') {
      try {
        previous.view?.deactivate?.();
      } catch (error) {
        reportCleanupError(error);
      }
      rememberCachedEntry(previous);
      return;
    }
    void scheduleViewCleanup(previous.view);
    appShell?.releaseRoute?.(previous.routeKey, previous.outlet);
  }

  function commitEntry(entry, { activate = false } = {}) {
    const previous = state.activeEntry;
    appShell?.commitRoute?.(entry.outlet, {
      routeKey: entry.routeKey,
      cachePolicy: entry.cachePolicy
    });
    state.activeEntry = entry;
    state.currentView = entry.view || null;
    state.pendingEntry = null;
    if (activate) {
      try {
        entry.view?.activate?.(entry.outlet, ...(entry.args || []));
      } catch (error) {
        reportCleanupError(error);
      }
    }
    if (entry.cachePolicy === 'keep-alive') rememberCachedEntry(entry);
    leavePreviousEntry(previous, entry);
  }

  async function navigate(hash = '#/chat') {
    const token = ++state.navigationToken;
    const startedAt = now();
    const correlationId = `nav-${token}-${Math.random().toString(36).slice(2, 8)}`;
    const requestedHash = String(hash || '#/chat');
    const route = resolveRoute(requestedHash);
    const routeKey = route.routeKey;
    const stagePayload = (result, extra = {}) => ({
      token,
      routeKey,
      correlationId,
      durationMs: Math.max(0, Math.round((now() - startedAt) * 100) / 100),
      ...(result ? { result } : {}),
      ...extra
    });
    emitStage('route_started', stagePayload(null));

    abandonPendingEntry();

    const app = getApp();
    const meta = getRouteMeta(requestedHash);
    const cachePolicy = route.cachePolicy || 'dispose';
    const cachedEntry = cachePolicy === 'keep-alive' ? cachedRoutes.get(routeKey) : null;
    let loadPromise = null;
    if (!cachedEntry) {
      try {
        // Start loading before touching the shell so module evaluation overlaps
        // the small amount of synchronous header/outlet preparation.
        loadPromise = asPromise(route.load());
      } catch (error) {
        loadPromise = Promise.reject(error);
      }
    }
    const outlet = appShell.mount(
      app,
      meta,
      requestedHash === '#/chat' ? 'chat' : 'standard',
      requestedHash,
      { routeKey, cachePolicy, reuse: Boolean(cachedEntry) }
    );
    emitStage('route_shell_mounted', stagePayload(null));

    if (cachedEntry) {
      const entry = { ...cachedEntry, outlet, args: route.args };
      commitEntry(entry, { activate: true });
      emitStage('route_module_loaded', stagePayload(null, { cacheHit: true }));
      emitStage('route_dom_committed', stagePayload(null, { cacheHit: true }));
      emitStage('route_render_completed', stagePayload('ok', { cacheHit: true }));
      afterPaint(() => emitStage('route_first_meaningful_paint', stagePayload('ok', { cacheHit: true })));
      return { ok: true, stale: false, token, view: entry.view, cacheHit: true };
    }

    let module;
    try {
      module = await loadPromise;
    } catch (error) {
      if (isCurrent(token)) {
        emitStage('route_module_loaded', stagePayload('failed'));
        onRenderError(error, requestedHash, outlet);
        renderRouteError(outlet);
        commitEntry({ view: null, outlet, routeKey, cachePolicy: 'dispose', args: [] });
        emitStage('route_render_completed', stagePayload('failed', { errorName: error?.name || 'Error' }));
      } else {
        appShell?.abortRoute?.(outlet, { routeKey });
        emitStage('route_render_completed', stagePayload('superseded'));
      }
      return { ok: false, stale: !isCurrent(token), token, error };
    }
    emitStage('route_module_loaded', stagePayload(null));

    if (!isCurrent(token)) {
      appShell?.abortRoute?.(outlet, { routeKey });
      emitStage('route_render_completed', stagePayload('superseded'));
      return { ok: false, stale: true, token };
    }

    const view = module?.[route.exportName] || module?.default;
    if (!view || typeof view.render !== 'function') {
      const error = new Error(`Route ${route.routeKey} did not export ${route.exportName}`);
      onRenderError(error, requestedHash, outlet);
      renderRouteError(outlet);
      commitEntry({ view: null, outlet, routeKey, cachePolicy: 'dispose', args: [] });
      emitStage('route_render_completed', stagePayload('failed', { errorName: error?.name || 'Error' }));
      return { ok: false, stale: false, token, error };
    }

    // Do not run a singleton view's new render concurrently with its prior
    // async cleanup, but keep this wait after shell mount so the old page is
    // never left visible while persistence drains.
    const pendingCleanup = pendingCleanups.get(view);
    if (pendingCleanup) {
      try {
        await pendingCleanup;
      } catch {
        // scheduleViewCleanup owns error reporting; navigation only waits for
        // the already-reported cleanup to settle.
      }
    }
    if (!isCurrent(token)) {
      emitStage('route_render_completed', stagePayload('superseded'));
      return { ok: false, stale: true, token };
    }

    // A singleton view may be re-rendered while an older render of the same
    // view is still in flight. Serialize same-view renders so the superseded
    // render finishes (and is torn down) before the live one starts; the
    // persistent shell and current page remain visible while this settles.
    const priorRender = pendingRenders.get(view);
    if (priorRender) {
      try {
        await priorRender;
      } catch (error) {
        reportCleanupError(error);
      }
    }
    if (priorRender && !isCurrent(token)) {
      appShell?.abortRoute?.(outlet, { routeKey });
      emitStage('route_render_completed', stagePayload('superseded'));
      return { ok: false, stale: true, token };
    }
    state.currentView = view;
    const entry = { view, outlet, routeKey, cachePolicy, args: route.args, abandoned: false };
    state.pendingEntry = entry;
    const renderClaim = (async () => view.render(outlet, ...route.args))();
    // The tracked chain observes settlement so the entry releases for both
    // completed and rejected renders; comparing against trackedRender (the
    // exact object that was stored) keeps a newer claim from being deleted.
    const trackedRender = renderClaim.then(() => {}, () => {}).then(async () => {
      if (entry.abandoned) await scheduleViewCleanup(view).catch(noop);
    }).finally(() => {
      if (pendingRenders.get(view) === trackedRender) pendingRenders.delete(view);
    });
    pendingRenders.set(view, trackedRender);
    try {
      await renderClaim;
    } catch (error) {
      if (isCurrent(token)) {
        onRenderError(error, requestedHash, outlet);
        renderRouteError(outlet);
        commitEntry({ view: null, outlet, routeKey, cachePolicy: 'dispose', args: [] });
        emitStage('route_render_completed', stagePayload('failed', { errorName: error?.name || 'Error' }));
      } else {
        appShell?.abortRoute?.(outlet, { routeKey });
        emitStage('route_render_completed', stagePayload('superseded'));
      }
      await trackedRender;
      return { ok: false, stale: !isCurrent(token), token, error };
    }
    await trackedRender;
    if (!isCurrent(token)) {
      entry.abandoned = true;
      appShell?.abortRoute?.(outlet, { routeKey });
      emitStage('route_render_completed', stagePayload('superseded'));
      return { ok: false, stale: true, token };
    }
    commitEntry(entry);
    emitStage('route_dom_committed', stagePayload(null));
    emitStage('route_render_completed', stagePayload('ok'));
    afterPaint(() => emitStage('route_first_meaningful_paint', stagePayload('ok')));
    return { ok: true, stale: false, token, view };
  }

  return {
    cleanupCurrentView,
    navigate,
    get currentView() {
      return state.currentView;
    },
    set currentView(view) {
      state.currentView = view;
    },
    get navigationToken() {
      return state.navigationToken;
    },
    get cachedRouteCount() {
      return cachedRoutes.size;
    }
  };
}
