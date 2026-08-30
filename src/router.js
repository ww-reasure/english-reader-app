/**
 * Router Module
 * Handles SPA hash-based routing with lazy page loading and cleanup on navigation
 */

import { AppShell } from './components/app-shell.js';
import { RouteHistory } from './components/route-history.js';
import { WordStudyDetail } from './components/word-study-detail.js';
import { preloadRoute, resolveRoute, warmCoreRoutes } from './router-routes.mjs';
import { createNavigationController } from './router-navigation.mjs';

const navigation = createNavigationController({
  appShell: AppShell,
  wordStudyDetail: WordStudyDetail,
  getApp: () => document.getElementById('app'),
  getRouteMeta: hash => AppShell.getRouteMeta(hash),
  resolveRoute,
  onCleanupError: error => console.error('[router] view cleanup failed', error),
  onRenderError: (error, hash) => console.error(`[router] render failed for ${hash}`, error),
  onFirstMeaningfulPaint: () => {
    globalThis.StartupMetricsBridge?.reportFullyDrawn?.();
  },
  recordEvent: (event, payload) => {
    try {
      globalThis?.__englishReaderDiagnosticLogger?.record(event, {
        category: 'app',
        level: payload?.result === 'failed' ? 'error' : 'info',
        correlationId: payload?.correlationId,
        payload
      });
    } catch {
      // Navigation evidence is best-effort and must not affect navigation.
    }
  }
});

export const Router = {
  routeHistory: null,

  get currentView() {
    return navigation.currentView;
  },

  set currentView(view) {
    navigation.currentView = view;
  },

  get navigationToken() {
    return navigation.navigationToken;
  },

  // Views that have cleanup methods
  viewsWithCleanup: ['ChatView', 'ReadingView', 'FlashcardView', 'AssessmentView', 'CalibrationView', 'ReadingListView', 'StatsView', 'ExamHomeView', 'ExamPracticeView', 'ExamResultView', 'ExamReviewView', 'ExamCatalogView', 'ExamHistoryView'],

  // Cleanup current view without delaying the next shell mount.
  cleanupCurrentView() {
    return navigation.cleanupCurrentView();
  },

  preload(hash) {
    return preloadRoute(hash).catch(() => undefined);
  },

  // Route to the correct view based on hash. The navigation controller mounts
  // the new shell synchronously, then loads and renders the view lazily.
  async navigate() {
    let hash = location.hash || '#/chat';
    if (hash === '#/learn-words') {
      hash = '#/vocab';
      history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
    }
    try {
      // Route keys are stable page identifiers without per-article ids or
      // query content, keeping navigation evidence privacy-safe.
      const routeKey = resolveRoute(hash).routeKey;
      globalThis?.__englishReaderDiagnosticLogger?.record('route.navigate', {
        category: 'app',
        route: routeKey,
        payload: { route: routeKey }
      });
    } catch {
      // Diagnostics are best-effort and must not affect navigation.
    }
    return navigation.navigate(hash);
  },

  // Get current article ID from hash
  getArticleId() {
    const hash = location.hash;
    const match = hash.match(/\/reading\/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  },

  // Initialize router
  init() {
    if (!location.hash) history.replaceState(history.state, '', location.pathname + location.search + '#/chat');
    this.routeHistory = new RouteHistory(location.hash || '#/chat');
    window.addEventListener('hashchange', () => {
      this.routeHistory.record(location.hash || '#/chat');
      this.navigate();
    });
    AppShell.setRouteIntentHandler(hash => this.preload(hash));
    void this.navigate().finally(() => {
      void warmCoreRoutes();
    });
  },

  back(fallbackRoute = '') {
    const previous = this.routeHistory?.previous();
    const destination = previous || fallbackRoute;
    if (!destination) return false;
    location.hash = destination;
    return true;
  }
};

window.Router = Router;
