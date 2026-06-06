/**
 * Router Module
 * Handles SPA hash-based routing
 */

const Router = {
  // Route to the correct view based on hash
  navigate() {
    const hash = location.hash || '#/chat';
    const app = document.getElementById('app');

    switch (true) {
      case hash === '#/chat':
        ChatView.render(app);
        break;
      case hash.startsWith('#/reading/'):
        const articleId = parseInt(hash.split('/')[2]);
        ReadingView.render(app, articleId);
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
