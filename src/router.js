/**
 * Router Module
 * Handles SPA hash-based routing with cleanup on navigation
 */

import { ChatView } from './views/chat.js';
import { ReadingView } from './views/reading.js';
import { HistoryView } from './views/history.js';
import { VocabularyView } from './views/vocabulary.js';
import { FlashcardView } from './views/flashcard.js';
import { LearnWordsView } from './views/learn-words.js';
import { SettingsView } from './views/settings.js';
import { StatsView } from './views/stats.js';
import { ReportView } from './views/report.js';
import { AssessmentView } from './views/assessment.js';
import { ReadingListView } from './views/reading-list.js';

const views = {
  ChatView, ReadingView, HistoryView, VocabularyView, FlashcardView,
  LearnWordsView, SettingsView, StatsView, ReportView, AssessmentView, ReadingListView
};

export const Router = {
  currentView: null,

  // Views that have cleanup methods
  viewsWithCleanup: ['ChatView', 'ReadingView', 'AssessmentView', 'ReadingListView'],

  // Cleanup current view before navigation
  cleanupCurrentView() {
    for (const viewName of this.viewsWithCleanup) {
      const view = views[viewName];
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
      case hash === '#/report':
        ReportView.render(app);
        break;
      case hash === '#/assessment':
        AssessmentView.render(app);
        break;
      case hash === '#/reading-list':
        ReadingListView.render(app);
        break;
      case hash === '#/profile':
        // Profile/stats page - use existing StatsView but keep route name
        await StatsView.render(app);
        break;
      default:
        ChatView.render(app);
    }

    this.updateNav(hash);
  },

  // Update tab bar active state
  updateNav(hash) {
    document.querySelectorAll('.tab-item').forEach(el => {
      const href = el.getAttribute('href');
      let isActive = false;
      if (href === '#/profile') {
        // "我的" tab matches #/profile, #/settings, #/report, #/assessment
        isActive = hash === '#/profile' || hash === '#/settings' || hash === '#/report' || hash === '#/assessment';
      } else if (href === '#/reading-list') {
        // "阅读" tab matches #/reading-list and #/reading/123
        isActive = hash === '#/reading-list' || hash.startsWith('#/reading/');
      } else if (href === '#/vocab') {
        // "词库" tab also covers SRS review and learning-word management
        isActive = hash === '#/vocab' || hash === '#/flashcard' || hash === '#/learn-words';
      } else {
        isActive = hash === href;
      }
      el.classList.toggle('active', isActive);
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
