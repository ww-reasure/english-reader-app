/**
 * Router Module
 * Handles SPA hash-based routing with cleanup on navigation
 */

const Router = {
  currentView: null,

  // Views that have cleanup methods
  viewsWithCleanup: ['ReadingView', 'AssessmentView'],

  // Cleanup current view before navigation
  cleanupCurrentView() {
    for (const viewName of this.viewsWithCleanup) {
      const view = window[viewName];
      if (view && typeof view.cleanup === 'function') {
        view.cleanup();
      }
    }
  },

  // Route to the correct view based on hash
  async navigate() {
    const hash = location.hash || '#/chat';
    const app = document.getElementById('app');

    // Cleanup previous view's event listeners
    this.cleanupCurrentView();

    switch (true) {
      case hash === '#/chat':
        await ChatView.render(app);
        break;
      case hash.startsWith('#/reading/'):
        const articleId = parseInt(hash.split('/')[2]);
        await ReadingView.render(app, articleId);
        break;
      case hash === '#/history':
        HistoryView.render(app);
        break;
      case hash === '#/vocab':
        VocabularyView.render(app);
        break;
      case hash === '#/flashcard':
        FlashcardView.render(app);
        break;
      case hash === '#/learn-words':
        LearnWordsView.render(app);
        break;
      case hash === '#/settings':
        SettingsView.render(app);
        break;
      case hash === '#/stats':
        StatsView.render(app);
        break;
      case hash === '#/assessment':
        AssessmentView.render(app);
        break;
      default:
        ChatView.render(app);
    }

    this.updateNav(hash);
  },

  // Update navigation link active state
  updateNav(hash) {
    document.querySelectorAll('.nav-link').forEach(el => {
      el.classList.toggle('active', el.getAttribute('href') === hash);
    });
  },

  // Get current article ID from hash
  getArticleId() {
    const hash = location.hash;
    const match = hash.match(/\/reading\/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  },

  // Initialize router
  init() {
    window.addEventListener('hashchange', () => this.navigate());
    if (!location.hash) location.hash = '#/chat';
    this.navigate();
  }
};
