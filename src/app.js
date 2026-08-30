/**
 * Main Application Entry Point
 * Initializes all modules and starts the app
 */

import { Theme } from './theme.js';
import { Config } from './config.js';
import { Modal } from './components/modal.js';
import { Router } from './router.js';
import { esc } from './helpers.js';
import { installNativeNavigation } from './components/native-navigation.js';
import { ArticleCatalog } from './components/article-catalog.js';
import { DB } from './db.js';
import { DailyLearningReportService } from './daily-learning-report-service.mjs';
import { DiagnosticLogger } from './diagnostic-logger.mjs';
import { getReviewPersistence } from './review-persistence.mjs';

const dailyLearningReportMaintenance = new DailyLearningReportService({ db: DB, examProvider: {} });

function scheduleCatalogPrewarm() {
  const prewarm = () => {
    void ArticleCatalog.prewarm().catch(() => {});
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(prewarm, { timeout: 2500 });
  } else {
    setTimeout(prewarm, 800);
  }
  // Returning to the foreground is a natural refresh boundary on mobile:
  // ArticleCatalog itself rate-limits this check to avoid duplicate requests.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') prewarm();
  }, { passive: true });
}

function scheduleDailyReportPrune() {
  const prune = () => {
    void dailyLearningReportMaintenance.prune().catch(error => {
      console.warn('Daily learning report cleanup failed:', error);
    });
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(prune, { timeout: 2500 });
  } else {
    setTimeout(prune, 800);
  }
}

export const App = {
  // Cached DOM reference
  appEl: null,
  diagnosticsInitialized: false,
  reviewPersistence: null,
  reviewPersistenceLifecycleInitialized: false,

  getApp() {
    if (!this.appEl) this.appEl = document.getElementById('app');
    return this.appEl;
  },

  // Initialize application
  async init() {
    this.initDiagnostics();
    try {
      // Start the visible application from synchronous display settings. The
      // native secret bridge and the single IndexedDB connection warm in
      // parallel instead of sitting in front of the first route.
      const configReady = Config.initialize();
      const databaseReady = DB.open();
      Theme.init();

      // AppShell is persistent and can paint immediately while the async
      // startup work above settles behind it.
      Router.init();
      this.reviewPersistence = getReviewPersistence(DB);
      void this.reviewPersistence.replay().catch(error => {
        DiagnosticLogger.record('review.pending_replay_failed', {
          category: 'review',
          level: 'warn',
          payload: { errorName: error?.name || 'Error' }
        });
      });
      this.initReviewPersistenceLifecycle();
      scheduleDailyReportPrune();
      scheduleCatalogPrewarm();
      const nativeNavigationReady = installNativeNavigation(Router);

      // Initialize global event listeners
      this.initGlobalEvents();
      const [configResult, databaseResult, nativeNavigationResult] = await Promise.allSettled([configReady, databaseReady, nativeNavigationReady]);
      if (configResult.status === 'rejected') {
        DiagnosticLogger.record('app.config_initialize_failed', {
          category: 'app', level: 'warn', payload: { errorName: configResult.reason?.name || 'Error' }
        });
      }
      if (databaseResult.status === 'rejected') {
        DiagnosticLogger.record('app.db_preconnect_failed', {
          category: 'db', level: 'warn', payload: { errorName: databaseResult.reason?.name || 'Error' }
        });
      }
      if (nativeNavigationResult.status === 'fulfilled') {
        this._removeNativeNavigation = nativeNavigationResult.value;
      }
      if (Config.shouldShowApiOnboarding()) {
        setTimeout(() => {
          if (Config.shouldShowApiOnboarding()) Modal.showApiSettings({ onboarding: true });
        }, 0);
      }

    } catch (err) {
      console.error('App initialization failed:', err);
      const app = this.getApp();
      if (app) {
        app.innerHTML = `
          <div class="empty-state">
            <p>应用初始化失败</p>
            <p style="color:var(--text-muted);font-size:13px">${esc(err.message)}</p>
            <button class="btn btn-primary" onclick="location.reload()">刷新重试</button>
          </div>`;
      }
    }
  },

  initReviewPersistenceLifecycle() {
    if (this.reviewPersistenceLifecycleInitialized) return;
    this.reviewPersistenceLifecycleInitialized = true;
    const flush = () => {
      void this.reviewPersistence?.flush({ timeoutMs: 1500 }).catch(error => {
        DiagnosticLogger.record('review.flush_failed', {
          category: 'review',
          level: 'warn',
          payload: { errorName: error?.name || 'Error' }
        });
      });
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    }, { passive: true });
    window.addEventListener('pagehide', flush, { passive: true });
  },

  initDiagnostics() {
    if (this.diagnosticsInitialized) return;
    this.diagnosticsInitialized = true;
    try {
      globalThis.__englishReaderDiagnosticLogger = DiagnosticLogger;
      globalThis.__englishReaderDiagnosticDB = DB;
      DiagnosticLogger.setContext({
        appVersion: globalThis.__ENGLISH_READER_VERSION || '2.0.0',
        platform: globalThis?.Capacitor?.getPlatform?.() || (globalThis?.Capacitor?.isNativePlatform?.() ? 'native' : 'web')
      });
      DiagnosticLogger.setPersistence({
        append: rows => DB.appendDiagnosticLogs(rows),
        list: range => DB.listDiagnosticLogs(range),
        clear: () => DB.clearDiagnosticLogs()
      });
      DiagnosticLogger.record('app.start', {
        category: 'app',
        payload: { online: typeof navigator === 'undefined' ? null : navigator.onLine }
      });
      if (typeof globalThis.PerformanceObserver === 'function'
        && globalThis.PerformanceObserver.supportedEntryTypes?.includes?.('longtask')) {
        this._performanceObserver = new globalThis.PerformanceObserver(list => {
          list.getEntries().forEach(entry => {
            if (entry.duration < 50) return;
            DiagnosticLogger.record('performance.long_task', {
              category: 'app',
              level: 'warn',
              durationMs: Math.round(entry.duration * 100) / 100,
              payload: { startTime: Math.round(entry.startTime * 100) / 100 }
            });
          });
        });
        this._performanceObserver.observe({ type: 'longtask', buffered: true });
      }

      window.addEventListener('error', event => {
        DiagnosticLogger.record('app.error', {
          category: 'error',
          level: 'error',
          payload: {
            errorName: event.error?.name || 'Error',
            errorMessage: event.message || event.error?.message || '',
            source: event.filename ? String(event.filename).split('/').pop() : ''
          }
        });
      });
      window.addEventListener('unhandledrejection', event => {
        console.error('Unhandled promise rejection:', event.reason);
        DiagnosticLogger.record('app.unhandled_rejection', {
          category: 'error',
          level: 'error',
          payload: {
            errorName: event.reason?.name || 'UnhandledRejection',
            errorMessage: event.reason?.message || String(event.reason || '')
          }
        });
      });
      document.addEventListener('visibilitychange', () => {
        DiagnosticLogger.record(document.visibilityState === 'visible' ? 'app.resume' : 'app.pause', {
          category: 'app',
          payload: { visibilityState: document.visibilityState }
        });
      }, { passive: true });
      window.addEventListener('online', () => DiagnosticLogger.record('network.online', { category: 'network', payload: { online: true } }));
      window.addEventListener('offline', () => DiagnosticLogger.record('network.offline', { category: 'network', level: 'warn', payload: { online: false } }));
    } catch (error) {
      // A diagnostics setup failure must never prevent the application from starting.
      console.warn('Diagnostic logging setup failed:', error);
    }
  },

  // Initialize global event listeners
  initGlobalEvents() {
    // Theme toggle
    document.getElementById('themeToggle')?.addEventListener('click', () => Theme.toggle());

    // API settings modal
    document.getElementById('settingsBtn')?.addEventListener('click', () => Modal.showApiSettings());
    document.getElementById('saveApiKey')?.addEventListener('click', () => Modal.saveApiSettings());
    document.getElementById('cancelApiKey')?.addEventListener('click', () => Modal.hideApiSettings());
    document.getElementById('closeApiKey')?.addEventListener('click', () => Modal.hideApiSettings());
    document.getElementById('modelPreset')?.addEventListener('change', () => Modal.onModelPresetChange());

    // Import modal
    document.getElementById('importFile')?.addEventListener('change', event => Modal.handleImportFile(event));
    document.getElementById('importSubmit')?.addEventListener('click', () => Modal.handleImport());
    document.getElementById('importCancel')?.addEventListener('click', () => Modal.hideImport());
  }
};

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
