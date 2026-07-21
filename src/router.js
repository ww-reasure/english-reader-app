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
import { AppShell } from './components/app-shell.js';

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
    if (this.currentView && typeof this.currentView.cleanup === 'function') this.currentView.cleanup();
    AppShell.cleanup();
    this.currentView = null;
  },

  // Route to the correct view based on hash
  async navigate() {
    const hash = location.hash || '#/chat';
    const app = document.getElementById('app');

    // Cleanup previous view's event listeners
    this.cleanupCurrentView();

    let view;
    let args = [];
    switch (true) {
      case hash === '#/chat':
        view = ChatView;
        break;
      case hash.startsWith('#/reading/'):
        view = ReadingView;
        args = [parseInt(hash.split('/')[2])];
        break;
      case hash === '#/history':
        view = HistoryView;
        break;
      case hash === '#/vocab':
        view = VocabularyView;
        break;
      case hash === '#/flashcard':
        view = FlashcardView;
        break;
      case hash === '#/learn-words':
        view = LearnWordsView;
        break;
      case hash === '#/settings':
        view = SettingsView;
        break;
      case hash === '#/stats':
        view = StatsView;
        break;
      case hash === '#/report':
        view = ReportView;
        break;
      case hash === '#/assessment':
        view = AssessmentView;
        break;
      case hash === '#/reading-list':
        view = ReadingListView;
        break;
      case hash === '#/profile':
        view = StatsView;
        break;
      default:
        view = ChatView;
    }

    const outlet = AppShell.mount(app, AppShell.getRouteMeta(hash), hash === '#/chat' ? 'chat' : 'standard');
    await view.render(outlet, ...args);
    this.currentView = view;
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
