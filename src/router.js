/**
 * Router Module
 * Handles SPA hash-based routing with cleanup on navigation
 */

import { ChatView } from './views/chat.js';
import { ReadingView } from './views/reading.js';
import { HistoryView } from './views/history.js';
import { VocabularyView } from './views/vocabulary.js';
import { FlashcardView } from './views/flashcard.js';
import { ReviewModeView } from './views/review-mode.js';
import { ContextReviewView } from './views/context-review.js';
import { LearnWordsView } from './views/learn-words.js';
import { SettingsView } from './views/settings.js';
import { StatsView } from './views/stats.js';
import { ReportView } from './views/report.js';
import { AssessmentView } from './views/assessment.js';
import { CalibrationView } from './views/calibration.js';
import { ReadingListView } from './views/reading-list.js';
import { ExamHomeView } from './views/exam-home.js';
import { ExamPracticeView } from './views/exam-practice.js';
import { ExamResultView } from './views/exam-result.js';
import { ExamReviewView } from './views/exam-review.js';
import { ExamCatalogView } from './views/exam-catalog.js';
import { ExamHistoryView } from './views/exam-history.js';
import { AppShell } from './components/app-shell.js';
import { RouteHistory } from './components/route-history.js';
import { WordStudyDetail } from './components/word-study-detail.js';

// exam/catalog/:type and exam/history are kept within the exam module.

const views = {
  ChatView, ReadingView, HistoryView, VocabularyView, FlashcardView, ReviewModeView, ContextReviewView,
  LearnWordsView, SettingsView, StatsView, ReportView, AssessmentView, CalibrationView, ReadingListView, ExamHomeView, ExamPracticeView, ExamResultView, ExamReviewView, ExamCatalogView, ExamHistoryView
};

export const Router = {
  currentView: null,
  routeHistory: null,

  // Views that have cleanup methods
  viewsWithCleanup: ['ChatView', 'ReadingView', 'FlashcardView', 'AssessmentView', 'CalibrationView', 'ReadingListView', 'StatsView', 'ExamHomeView', 'ExamPracticeView', 'ExamResultView', 'ExamReviewView', 'ExamCatalogView', 'ExamHistoryView'],

  // Cleanup current view before navigation
  async cleanupCurrentView() {
    WordStudyDetail.close();
    if (this.currentView && typeof this.currentView.cleanup === 'function') {
      await this.currentView.cleanup();
    }
    AppShell.cleanup();
    this.currentView = null;
  },

  // Route to the correct view based on hash
  async navigate() {
    const hash = location.hash || '#/chat';
    const app = document.getElementById('app');

    // Cleanup previous view's event listeners
    await this.cleanupCurrentView();

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
        view = ReviewModeView;
        break;
      case hash === '#/flashcard/recall':
        view = FlashcardView;
        break;
      case /^#\/flashcard\/practice\/[a-z_]+$/.test(hash): {
        view = FlashcardView;
        args = [hash.split('/').pop()];
        break;
      }
      case hash === '#/flashcard/context':
        view = ContextReviewView;
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
        view = CalibrationView;
        break;
      case hash === '#/reading-list':
        view = ReadingListView;
        break;
      case hash === '#/exam':
        view = ExamHomeView;
        break;
      case hash === '#/exam/review':
        view = ExamReviewView;
        break;
      case hash === '#/exam/history':
        view = ExamHistoryView;
        break;
      case /^#\/exam\/catalog\//.test(hash): {
        view = ExamCatalogView;
        const [, type] = hash.match(/^#\/exam\/catalog\/([^/]+)$/) || [];
        args = [decodeURIComponent(type || '')];
        break;
      }
      case /^#\/exam\/practice\//.test(hash): {
        view = ExamPracticeView;
        const [, attemptId, mode] = hash.match(/^#\/exam\/practice\/([^/]+)(?:\/(explanation))?$/) || [];
        args = [decodeURIComponent(attemptId || ''), mode || null];
        break;
      }
      case /^#\/exam\/result\//.test(hash): {
        view = ExamResultView;
        args = [decodeURIComponent(hash.split('/').pop())];
        break;
      }
      case hash === '#/profile':
        view = StatsView;
        break;
      default:
        view = ChatView;
    }

    const outlet = AppShell.mount(app, AppShell.getRouteMeta(hash), hash === '#/chat' ? 'chat' : 'standard', hash);
    try {
      await view.render(outlet, ...args);
    } catch (error) {
      console.error(`[router] render failed for ${hash}`, error);
      outlet.innerHTML = `<section class="app-standard-page route-render-error"><p class="page-eyebrow">TEMPORARY ERROR</p><h2>页面暂时无法打开</h2><p>请返回后重试；已有学习记录不会丢失。</p><a class="btn btn-primary" href="#/exam">返回真题训练</a></section>`;
    }
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
    if (!location.hash) history.replaceState(history.state, '', location.pathname + location.search + '#/chat');
    this.routeHistory = new RouteHistory(location.hash || '#/chat');
    window.addEventListener('hashchange', () => {
      this.routeHistory.record(location.hash || '#/chat');
      this.navigate();
    });
    this.navigate();
  },

  back() {
    const previous = this.routeHistory?.previous();
    if (!previous) return false;
    location.hash = previous;
    return true;
  }
};

window.Router = Router;
