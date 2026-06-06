/**
 * Main Application Entry Point
 * Initializes all modules and starts the app
 */

const App = {
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
      Theme.init();

      // Check for API key on first load
      if (!Config.hasApiKey()) {
        Modal.showApiSettings(true);
      }

      // Start router
      Router.init();

      // Initialize global event listeners
      this.initGlobalEvents();

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
    document.getElementById('modelPreset')?.addEventListener('change', () => Modal.onModelPresetChange());

    // Import modal
    document.getElementById('importSubmit')?.addEventListener('click', () => Modal.handleImport());
    document.getElementById('importCancel')?.addEventListener('click', () => Modal.hideImport());
  }
};

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
