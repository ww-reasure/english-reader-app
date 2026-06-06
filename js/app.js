/**
 * Main Application Entry Point
 * Initializes all modules and starts the app
 */

const App = {
  // Initialize application
  init() {
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
