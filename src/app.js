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

export const App = {
  // Cached DOM reference
  appEl: null,

  getApp() {
    if (!this.appEl) this.appEl = document.getElementById('app');
    return this.appEl;
  },

  // Initialize application
  async init() {
    try {
      // Initialize modules
      await Config.initialize();
      Theme.init();

      // Start router
      Router.init();
      scheduleCatalogPrewarm();
      this._removeNativeNavigation = await installNativeNavigation(Router);

      // Initialize global event listeners
      this.initGlobalEvents();
      if (Config.shouldShowApiOnboarding()) {
        setTimeout(() => {
          if (Config.shouldShowApiOnboarding()) Modal.showApiSettings({ onboarding: true });
        }, 0);
      }

      // Global error handler for unhandled promise rejections
      window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
      });
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
    document.getElementById('importSubmit')?.addEventListener('click', () => Modal.handleImport());
    document.getElementById('importCancel')?.addEventListener('click', () => Modal.hideImport());
    document.getElementById('importFile')?.addEventListener('change', event => Modal.handleImportFile(event));
  }
};

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
