/**
 * Chat View
 * Handles article generation with preset topics and smart word integration
 */

import { Config } from '../config.js';
import { DIFFICULTY_LABELS, esc } from '../helpers.js';
import { DB } from '../db.js';
import { API } from '../api.js';
import { Modal } from '../components/modal.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { AudioCache } from '../audio-cache.js';
import { Dictionary } from '../dictionary.js';
import { ConversationStore } from '../components/conversation-store.js';
import {
  collectImageObjectUrls,
  compactPersistentHomeMessageNodes,
  releaseRemovedImageObjectUrls
} from '../home-runtime-resource-compaction.mjs';
import { LEARNING_TOOLS, LearningAgent } from '../components/learning-agent.js';
import { ContextBuilder } from '../components/context-builder.js';
import { ChatService } from '../components/chat-service.js';
import { classifyComposerIntent } from '../components/composer-intent.js';
import { isGenerationAuthorized } from '../components/generation-authorization.mjs';
import { renderLearningMarkdown } from '../components/rich-text.js';
import { bindMessageCopy, createCopyButton } from '../components/message-actions.mjs';
import { ChatSelectionActions, normalizeSelectedExcerpt } from '../components/chat-selection-actions.mjs';
import { ArticleGenerationTool, GENERATE_READING_TOOL, admitArticle, normalizeTargetWords } from '../components/article-generation-tool.js';
import { resolveGenerationRequest } from '../components/generation-request.js';
import {
  createGenerationFailure as makeGenerationFailure,
  isCancelledGenerationRequest,
  normalizeGenerationFailure as hydrateGenerationFailure
} from '../components/generation-failure.mjs';
import { HomeRequestGate } from '../components/home-request-gate.mjs';
import { HomeGenerationCoordinator } from '../components/home-generation-coordinator.mjs';
import { getSharedArticleQualityService } from '../components/article-quality-service.mjs';
import { planReviewBatches } from '../components/review-generation-plan.mjs';
import { buildArticleGenerationPolicy } from '../reading-personalization.mjs';
import { createKnowledgeProfileRepository } from '../knowledge-profile.mjs';
import { createLearnerProfileProvider } from '../learner-profile.mjs';
import { normalizeSelectableTrack, requiresTargetTrackSelection } from '../learning-track.mjs';
import { MAX_PDF_WORDS, MAX_WORDS_PER_BATCH, WordImportService, normalizeImportWords } from '../word-import-service.mjs';
import { createPdfImportService } from '../pdf-import.mjs';
import { DailyLearningReportService } from '../daily-learning-report-service.mjs';
import { toDailyReportHistoryToolResult, toDailyReportToolResult } from '../daily-learning-report.mjs';
import { renderDailyReportCard } from '../components/daily-report-card.mjs';
import { APP_CAPABILITY_TOOLS, AppCapabilityRegistry, createCapabilityActionArtifact } from '../components/app-capabilities.mjs';
import { HomeAgentUsageTelemetry } from '../components/ai-usage-telemetry.mjs';
import { ExamCorpus } from '../exam-corpus-runtime.mjs';
import { createExamServices } from '../exam/create-services.js';
import { createExamLearningOverviewProvider } from '../exam/learning-overview-provider.mjs';
import { isSyntheticExamPaper } from '../exam/home-visibility.mjs';
import { SUPPORTED_EXAM_IDS } from '../exam/constants.mjs';
import { buildResearchBrief, createWebResearch, normalizeResearchSources } from '../components/web-research.mjs';
import { buildNativeResearchArtifact, messagesToResponsesItems, resolveWebResearchPlan } from '../components/deepseek-responses.mjs';
import { ChatImageService } from '../components/chat-image-service.js';
import { createChatImageProcessor } from '../components/chat-image-processor.js';
import { resolveModelForRequest } from '../components/deepseek-model-catalog.mjs';
import * as chatImagePolicy from '../components/chat-image-policy.mjs';
import {
  advanceGuidedLearning,
  classifyHomeLearningRequest,
  normalizeGuidedLearningSession,
  normalizeHomeLearningResponseMode,
  recordGuidedChoice,
  recordGuidedFreeResponse,
  setGuidedLearningStatus,
  setGuidedLearningStep,
  toggleGuidedLearningHint
} from '../components/home-guided-learning.mjs';
import {
  ADAPT_GUIDED_LEARNING_TOOL,
  CREATE_GUIDED_LEARNING_TOOL,
  createGuidedLearningArtifact,
  createGuidedLearningUpdateArtifact,
  guidedLearningSystemInstruction,
  parseGuidedLearningJson
} from '../components/guided-learning-tool.mjs';
import {
  renderGuidedLearningCard,
  renderGuidedLearningFailureCard,
  renderLearningModeChoiceCard
} from '../components/guided-learning-card.mjs';

const conversationStore = new ConversationStore();
const examServices = createExamServices();
const examLearningProvider = createExamLearningOverviewProvider({ services: examServices });
const examRecordIdentity = value => `${value?.bankId || ''}:${value?.paperKey || ''}`;
const pdfImportService = createPdfImportService();

function diagnosticLogger() {
  return globalThis.__englishReaderDiagnosticLogger || null;
}

const dailyExamProvider = {
  async getDailyFacts() {
    const [paperGroups, attemptGroups, wrongGroups, translationGroups] = await Promise.all([
      Promise.all(SUPPORTED_EXAM_IDS.map(examId => examServices.contentRepository.listPapers({ examId }))),
      Promise.all(SUPPORTED_EXAM_IDS.map(examId => examServices.stateRepository.listAttempts({ examId }))),
      Promise.all(SUPPORTED_EXAM_IDS.map(examId => examServices.stateRepository.listWrongStates({ examId }))),
      Promise.all(SUPPORTED_EXAM_IDS.map(examId => examServices.stateRepository.listTranslationReviews({ examId })))
    ]);
    const allPapers = paperGroups.flat();
    const realPapers = allPapers.filter(paper => !isSyntheticExamPaper(paper));
    const papers = (realPapers.length ? realPapers : allPapers);
    const visiblePaperKeys = new Set(papers.map(examRecordIdentity));
    const attempts = attemptGroups.flat().filter(item => visiblePaperKeys.has(examRecordIdentity(item)));
    const wrongStates = wrongGroups.flat().filter(item => visiblePaperKeys.has(examRecordIdentity(item)));
    const translationReviews = translationGroups.flat().filter(item => visiblePaperKeys.has(examRecordIdentity(item)));
    const responseRows = await Promise.all(attempts.map(async attempt => [
      attempt.attemptId,
      await examServices.stateRepository.getResponses({ examId: attempt.examId, attemptId: attempt.attemptId })
    ]));
    return {
      papers,
      attempts,
      responsesByAttempt: Object.fromEntries(responseRows),
      wrongStates,
      translationReviews
    };
  }
};
const dailyLearningReportService = new DailyLearningReportService({
  db: DB,
  examProvider: dailyExamProvider
});
const knowledgeProfile = createKnowledgeProfileRepository(DB);
const learnerProfileProvider = createLearnerProfileProvider({
  config: Config,
  knowledgeProfile
});
const webResearch = createWebResearch({ config: Config });
const learningAgent = new LearningAgent({
  db: DB,
  srs: SpacedRepetition,
  examCorpus: ExamCorpus,
  examLearningProvider,
  dailyReportProvider: dailyLearningReportService,
  learnerProfileProvider,
  targetTrack: () => Config.get('exam_level') || ''
});
const contextBuilder = new ContextBuilder({ capabilityIndex: AppCapabilityRegistry.compactIndex() });
const homeWebResearch = {
  resolve: () => resolveWebResearchPlan({
    mode: Config.get('web_research_mode'),
    model: Config.get('model'),
    baseUrl: Config.get('base_url'),
    tavilyKey: Config.get('tavily_api_key')
  }),
  toItems: messagesToResponsesItems,
  artifact: buildNativeResearchArtifact
};
const chatService = new ChatService({ api: API, agent: learningAgent, builder: contextBuilder, telemetry: HomeAgentUsageTelemetry, webResearch: homeWebResearch });
const imageService = new ChatImageService({
  db: DB,
  api: API,
  processor: createChatImageProcessor(),
  policy: chatImagePolicy
});
const articleQualityService = getSharedArticleQualityService({ api: API, db: DB });
const articleGenerationTool = new ArticleGenerationTool({
  api: API,
  db: DB,
  examCorpus: ExamCorpus,
  admit: admitArticle,
  inspectQuality: articleQualityService.inspectQuality
});
const wordImportService = new WordImportService({ db: DB, lookup: Dictionary.lookup.bind(Dictionary) });
const generationPolicyFor = challenge => buildArticleGenerationPolicy({
  calibrationStatus: Config.get('calibration_status'),
  challenge,
  coverage: Config.get('coverage')
});
const SEARCH_WEB_TOOL = {
  type: 'function',
  function: {
    name: 'search_web',
    description: '联网检索最新资讯或外部事实。仅在用户询问最新事件、需要核实时效信息，或表达结合近期热点阅读的兴趣时调用；普通词汇、语法和复习问题不要联网。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索主题' },
        recencyDays: { type: 'integer', minimum: 1, maximum: 30, description: '只取最近几天内的结果' },
        domains: { type: 'array', items: { type: 'string' }, maxItems: 5, description: '限定来源域名' }
      },
      required: ['query']
    }
  }
};
const RECENT_HOME_ACTIVITY_TOOL = {
  type: 'function',
  function: {
    name: 'get_recent_learning_activity',
    description: '查询首页近期真实学习活动，用于回答刚刚生成了什么、成功几篇或耗时多久。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } }
    }
  }
};
const HOME_LEARNING_TOOLS = [...LEARNING_TOOLS, ...APP_CAPABILITY_TOOLS, RECENT_HOME_ACTIVITY_TOOL, SEARCH_WEB_TOOL, GENERATE_READING_TOOL];
const homeRequestGate = new HomeRequestGate();
let generationFailureSequence = 0;
const nextGenerationFailureId = () => `generation-failure-${Date.now()}-${++generationFailureSequence}`;
let guidedLearningSequence = 0;
const nextGuidedLearningId = prefix => `${prefix}-${Date.now()}-${++guidedLearningSequence}-${Math.random().toString(36).slice(2, 7)}`;
const redactAgentSecrets = value => String(value || '')
  .replace(/(sk-[A-Za-z0-9_\-]{8,})/g, 'sk-***')
  .replace(/(tvly-[A-Za-z0-9_\-]{8,})/g, 'tvly-***');

export const dailyReportArtifactOf = report => {
  const facts = report?.facts || report?.data || report;
  const dateKey = String(report?.dateKey || facts?.dateKey || '').trim();
  if (!dateKey || report?.status === 'unavailable') return null;
  return {
    type: 'daily_learning_report',
    reportId: `daily:${dateKey}`,
    dateKey,
    dataFingerprint: String(report?.dataFingerprint || '')
  };
};

const cancelledRequest = () => {
  const error = new Error('请求已取消');
  error.name = 'AbortError';
  return error;
};
const generationProgressLabel = ({ phase } = {}) => ({
  drafting: '正在撰写文章…',
  checking: '正在检查难度…',
  refining: '正在按校验结果精修…'
}[phase] || '文章定制中…');
const generationAdjustmentMessage = adjustment => {
  const { requested, resolved, range } = adjustment;
  return `已按当前难度档案将篇幅从 ${requested} 词调整为 ${resolved} 词（允许范围 ${range.min}-${range.max} 词）。`;
};

export const DEFAULT_IMAGE_LEARNING_PROMPT = '请识别这些图片的内容，并结合我当前的英语学习目标进行讲解。若包含文章或题目，请按图片顺序说明重点、答案依据、易错点和值得学习的词汇；看不清的地方请明确指出，不要猜测。';

// Chat history persistence
export const ChatHistory = {
  KEY: 'chatHistory',
  MAX_MESSAGES: 100,

  save(messages) {
    try {
      const data = JSON.stringify(messages.slice(-this.MAX_MESSAGES));
      // Check localStorage quota (~5MB typical)
      if (data.length > 4 * 1024 * 1024) {
        // Too large, keep only last 30 messages
        localStorage.setItem(this.KEY, JSON.stringify(messages.slice(-30)));
      } else {
        localStorage.setItem(this.KEY, data);
      }
    } catch (err) {
      // QuotaExceededError — clear old data
      try {
        localStorage.removeItem(this.KEY);
      } catch {}
    }
  },

  load() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY)) || [];
    } catch {
      return [];
    }
  },

  clear() {
    localStorage.removeItem(this.KEY);
  }
};

// Global pending articles queue (survives page navigation)
export const PendingArticles = {
  queue: [],

  add(article, reviewKeywords) {
    this.queue.push({ article, reviewKeywords, timestamp: Date.now() });
    this.updateBadge();
  },

  getAll() {
    const items = [...this.queue];
    this.queue = [];
    this.updateBadge();
    return items;
  },

  hasPending() {
    return this.queue.length > 0;
  },

  updateBadge() {
    // The global tab bar has been replaced by AppShell; pending cards are restored on home.
  }
};

export const ChatView = {
  isReviewGenerating: false,
  homeEpoch: 0,
  _clearContextHandler: null,
  _generationPreviewQueue: new Map(),
  _generationPreviewTimer: null,
  _searchCallCounts: new Map(),
  _messageCopyCleanup: null,
  _chatSelectionActions: null,
  _chatFollowUpExcerpt: '',
  _guidedReplyTarget: null,
  _guidedActionCleanup: null,
  _learningTextLookupCleanup: null,
  _learningTextLookupPromise: null,
  _learningTextLookupRoot: null,
  _guidedRequestController: null,
  _dailyReportRequestPending: false,
  imageDraftGroupId: null,
  activeImageGroupId: null,
  imageDraftState: 'idle',
  imageService: null,
  _imageDraftObjectUrls: new Map(),
  _imageActionCleanup: null,
  _imageViewerCleanup: null,
  _imageRequestController: null,
  // Preset topics
  topics: [
    { value: 'technology', label: '科技' },
    { value: 'news', label: '新闻' },
    { value: 'education', label: '教育' },
    { value: 'health', label: '健康' },
    { value: 'environment', label: '环境' },
    { value: 'economy', label: '经济' },
    { value: 'culture', label: '文化' },
    { value: 'sports', label: '体育' },
    { value: 'travel', label: '旅行' },
    { value: 'daily', label: '日常生活' },
    { value: 'career', label: '职场' },
    { value: 'psychology', label: '心理学' }
  ],

  // Render chat view
  async render(container) {
    this.releaseChatActions();
    conversationStore.pruneExpiredArticleSessions(7 * 86400000);
    this.imageService = imageService;
    diagnosticLogger()?.record('chat.rendered', {
      category: 'ai',
      payload: { scope: 'home' }
    });

    container.innerHTML = `
      <div class="chat-container">
        <div id="chatMessages" class="chat-messages">${this.studyAnchorMarkup()}</div>

        <footer class="chat-composer">
          <div id="guidedLearningReplyChip" class="guided-learning-reply-chip" hidden>
            <div><span>正在回答当前教学</span><p id="guidedLearningReplyText"></p></div>
            <button id="guidedLearningReplyClear" type="button" aria-label="取消回答当前教学">×</button>
          </div>
          <div id="chatFollowUpChip" class="chat-follow-up-chip" hidden>
            <div class="chat-follow-up-copy">
              <span>引用上一条回复</span>
              <p id="chatFollowUpText"></p>
            </div>
            <button id="chatFollowUpClear" type="button" aria-label="取消引用">×</button>
          </div>
          <div id="quickActionRail" class="quick-action-rail" aria-label="快捷操作">
            <button class="quick-action" type="button" data-action="random"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>随机生成</button>
            <button class="quick-action" type="button" data-action="review"><i class="fa-solid fa-book-open" aria-hidden="true"></i>复习阅读</button>
            <button class="quick-action" type="button" data-action="topic" data-topic="technology"><i class="fa-solid fa-microchip" aria-hidden="true"></i>科技</button>
            <button class="quick-action" type="button" data-action="topic" data-topic="psychology"><i class="fa-solid fa-brain" aria-hidden="true"></i>心理学</button>
            <button class="quick-action" type="button" data-action="topic" data-topic="travel"><i class="fa-solid fa-plane" aria-hidden="true"></i>旅行</button>
            <button class="quick-action" type="button" data-action="import-article"><i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>导入文章</button>
            <button class="quick-action" type="button" data-action="import-words"><i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i>导入单词</button>
            <button class="quick-action" type="button" data-action="daily-report"><i class="fa-solid fa-chart-line" aria-hidden="true"></i>今日日报</button>
            <a class="quick-action" href="#/vocab"><i class="fa-solid fa-bookmark" aria-hidden="true"></i>我的词汇</a>
          </div>
          <div id="chatImageActionSheet" class="chat-image-action-sheet" hidden aria-label="添加图片方式">
            <button type="button" data-image-action="camera"><i class="fa-solid fa-camera" aria-hidden="true"></i>拍照</button>
            <button type="button" data-image-action="gallery"><i class="fa-solid fa-images" aria-hidden="true"></i>从相册选择</button>
            <button type="button" data-image-action="cancel">取消</button>
          </div>
          <input id="chatCameraInput" type="file" accept="image/*" capture="environment" hidden>
          <input id="chatGalleryInput" type="file" accept="image/*" multiple hidden>
          <div id="chatImageDraftStrip" class="chat-image-draft-strip" aria-live="polite" hidden></div>
          <div id="chatActiveImageChip" class="chat-active-image-chip" hidden aria-live="polite"></div>
          <div class="chat-input-row">
            <button id="composerImageBtn" class="composer-icon-btn" type="button" aria-label="添加图片" aria-expanded="false"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
            <textarea id="promptInput" name="learningPrompt" placeholder="问问题，或说“生成一篇关于……”" aria-label="学习问题" rows="1"></textarea>
            <button id="generateBtn" class="composer-generate-btn" type="button" aria-label="发送问题"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
          </div>
        </footer>
      </div>`;

    this.bindEvents();

    // Restore chat history
    await this.restoreHistory();
    await this.restoreImageState();

    // Show any pending articles from previous generation
    this.showPendingArticles();

    await this.restoreHomeGenerationJob();

    // Listen for article-imported events from modal.js
    this._bindImportEvent();
  },

  // Bind import event listener (先移除旧监听, 避免多次进出 chat 页导致监听累积、导入一次插多条)
  _bindImportEvent() {
    if (this._importHandler) {
      document.removeEventListener('article-imported', this._importHandler);
    }
    this._importHandler = (e) => {
      this.addArticleCard(e.detail.article);
    };
    document.addEventListener('article-imported', this._importHandler);
  },

  // Restore the migrated or current home conversation.
  async restoreHistory() {
    const session = conversationStore.getSession('home');
    if (session.messages.length === 0) {
      const assessmentDone = Config.get('assessment_done') === 'true';
      if (assessmentDone) {
        this.addMessageToDOM('system', '欢迎回来！你可以问我词汇、语法、阅读策略，或让它根据你的学习情况安排复习。');
      } else {
        this.addWelcomeWithAssessment();
      }
    } else {
      for (const message of session.messages) {
        const messageId = this.homeMessageIdentity(message);
        if (message.kind === 'article') {
          this.addArticleCardToDOM(message.article, messageId);
        } else if (message.kind === 'generation_failure') {
          this.addGenerationFailureToDOM(message.failure, messageId);
        } else if (message.kind === 'app_actions') {
          this.addAppActionsToDOM(message.actions || [], messageId);
        } else if (message.kind === 'research_sources') {
          this.addResearchSourcesToDOM(message.research || message, messageId);
        } else if (message.kind === 'activity') {
          // Activity events are model context, not duplicate visible chat bubbles.
        } else if (message.kind === 'daily_report') {
          await this.restoreDailyReportReference({ ...message, id: messageId });
        } else if (message.kind === 'learning_mode_choice') {
          this.addLearningModeChoiceToDOM(message);
        } else if (message.kind === 'guided_learning') {
          this.addGuidedLearningToDOM(message.session, message.id || message.createdAt);
        } else if (message.kind === 'guided_learning_failure') {
          this.addGuidedLearningFailureToDOM(message.failure, message);
        } else {
          await this.addMessageToDOM(
            message.kind === 'notice' ? 'system' : message.kind === 'error' ? 'error' : message.role,
            message.content,
            { imageGroup: message.imageGroup, messageId }
          );
        }
      }
    }

    // Check for due words and show reminder
    await this.showDueReminder();
  },

  // Show due words reminder
  async showDueReminder() {
    try {
      const allWords = await DB.getAllLearnWords();
      const dueCount = SpacedRepetition.getDueCount(allWords);
      if (dueCount > 0) {
        const container = document.getElementById('chatMessages');
        if (!container) return;
        const div = document.createElement('div');
        div.className = 'message system-message';
        div.innerHTML = `
          <div class="due-reminder">
            <i class="fa-solid fa-bell" aria-hidden="true"></i> 你有 <strong>${dueCount}</strong> 个单词需要复习
            <a href="#/flashcard" class="btn btn-primary btn-sm">开始复习</a>
          </div>`;
        const anchor = container.querySelector('.chat-study-intro');
        anchor ? anchor.insertAdjacentElement('afterend', div) : container.insertBefore(div, container.firstChild);
      }
    } catch {
      // Ignore errors
    }
  },

  // Show welcome message with assessment CTA
  addWelcomeWithAssessment() {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'message system-message';
    div.innerHTML = `
      <div class="welcome-box">
        <h3>欢迎使用英语阅读助手</h3>
        <p>首次使用建议先完成<strong>3 分钟阅读校准</strong>。它用离线词义题和短阅读推荐材料压力，不会把收藏或加入词库误当成“已掌握”。</p>
        <div class="welcome-actions">
          <a href="#/assessment" class="btn btn-primary btn-sm">开始测评（约 3 分钟）</a>
          <button class="btn btn-outline btn-sm" onclick="ChatView.skipAssessment()">跳过，直接使用</button>
        </div>
      </div>`;
    container.appendChild(div);
  },

  // Skip assessment
  skipAssessment() {
    // Skipping is deliberately a conservative, *uncalibrated* state.  It is
    // not a successful assessment and must not suppress the three-reading
    // feedback checkpoint later on.
    if (Config.get('target_track_selection_required') === 'true') {
      location.hash = '#/assessment';
      return;
    }
    Config.set('assessment_done', 'false');
    Config.set('calibration_status', 'skipped');
    Config.set('reading_mode', 'support');
    Config.set('level', 'easy');
    Config.set('coverage', '97');
    Config.set('new_word_percent', '3');
    const container = document.getElementById('chatMessages');
    if (container) container.innerHTML = this.studyAnchorMarkup();
    this.addMessageToDOM('system', '已进入未校准的保守阅读：会优先使用高频基础词、较短句和少量目标重点词。完成 3 篇有效阅读后，我会只问一次“偏难 / 合适 / 偏易”，帮助校正推荐；随时可以在「设置」中完成 3 分钟校准。');
  },

  // Clear chat history and the durable image context belonging to this session.
  clearHistory() {
    if (!confirm('清除本次对话的上下文和显示记录？已保存的阅读文章不受影响。')) return;
    return this.clearHistoryConfirmed();
  },

  async clearHistoryConfirmed() {
    this.homeEpoch += 1;
    this.beginHomeRequest({ cancelGeneration: true, cancelReason: 'clear_context' });
    conversationStore.clear('home');
    ChatHistory.clear();
    await imageService.clearConversation('home');
    this.imageDraftGroupId = null;
    this.activeImageGroupId = null;
    this.imageDraftState = 'idle';
    this.revokeImageObjectUrls();
    this.clearChatFollowUp();
    this.clearGuidedLearningReply();
    await this.renderActiveImageChip();
    const container = document.getElementById('chatMessages');
    if (container) container.innerHTML = this.studyAnchorMarkup();
    this.addMessageToDOM('system', '对话已清空。现在可以开始新的学习问题。');
  },

  beginHomeRequest({ cancelGeneration = false, cancelReason = 'superseded' } = {}) {
    const requestVersion = homeRequestGate.begin();
    this._guidedRequestController?.abort();
    this._guidedRequestController = null;
    this._imageRequestController?.abort();
    this._imageRequestController = null;
    chatService.cancel('home');
    if (cancelGeneration) {
      homeGenerationCoordinator?.cancel(cancelReason);
      this.isReviewGenerating = false;
    }
    this.resetGenerateButton();
    this.removeThinking();
    this.removeArticleGenerationStatus();
    return requestVersion;
  },

  isHomeRequestActive(epoch, requestVersion) {
    return this.homeEpoch === epoch && homeRequestGate.isCurrent(requestVersion);
  },

  hasPublishedGenerationArticle(jobId, articleId) {
    return conversationStore.getSession('home').messages.some(message => (
      message.kind === 'article'
      && (message.article?.generationJobId === jobId || message.article?.id === articleId)
    ));
  },

  hasPublishedGenerationFailure(jobId) {
    return conversationStore.getSession('home').messages.some(message => (
      message.kind === 'generation_failure' && message.failure?.generationJobId === jobId
    ));
  },

  async findArticleForGenerationJob(jobId) {
    const articles = await DB.getAllArticles();
    return articles.find(article => article.generationJobId === jobId) || null;
  },

  syncHomeGenerationUI(job) {
    if (!document.getElementById('chatMessages') || !job) return;
    if (job.status === 'running') {
      this.isReviewGenerating = job.kind === 'review';
      const label = job.kind === 'review' && /^review-/.test(job.phase || '')
        ? job.phase.replace(/^review-/, '')
        : generationProgressLabel({ phase: job.phase });
      this.showArticleGenerationStatus(label);
      const previewCount = job.kind === 'review' ? (job.payload?.batches?.length || 1) : 1;
      for (let batchIndex = 0; batchIndex < previewCount; batchIndex += 1) {
        const preview = homeGenerationCoordinator.getPreview(job.id, batchIndex);
        if (preview) this.syncHomeGenerationPreview(preview);
      }
      return;
    }
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      this.isReviewGenerating = false;
      this.resetGenerateButton();
      this.removeArticleGenerationStatus();
      this.removeHomeGenerationPreviews(job.id);
    }
  },

  async restoreHomeGenerationJob() {
    const job = homeGenerationCoordinator.getJob();
    if (!job) return null;
    this.syncHomeGenerationUI(job);
    if (job.status === 'running' || job.status === 'interrupted') {
      const resumed = await homeGenerationCoordinator.resumePending();
      this.syncHomeGenerationUI(resumed);
      return resumed;
    }
    return job;
  },

  startHomeGenerationJob({ kind, payload, cancelExisting = true }) {
    if (cancelExisting) homeGenerationCoordinator.cancel('superseded');
    this.isReviewGenerating = kind === 'review';
    return homeGenerationCoordinator.start({ kind, payload });
  },

  async publishHomeGenerationArticle(job, article, keywords, runtime, batchIndex = 0) {
    if (!this.hasPublishedGenerationArticle(job.id, article.id)) {
      this.addArticleCard(article);
      if (keywords) this.addMessage('system', `已自动融入我的词汇中的单词：${keywords}`);
      runtime.updateJob({ publishedArticleIds: [...new Set([...(job.publishedArticleIds || []), article.id])] });
    }
    runtime.clearPreview?.(batchIndex);
  },

  async publishHomeGenerationFailure(job, error, runtime) {
    if (job.failureId || this.hasPublishedGenerationFailure(job.id)) return;
    const generation = job.payload?.generation || {};
    const failure = this.createGenerationFailure(error, generation, job.payload?.topic);
    failure.generationJobId = job.id;
    const failureId = job.payload?.retryFailureId
      ? (this.replaceGenerationFailure(job.payload.retryFailureId, failure), job.payload.retryFailureId)
      : this.addGenerationFailure(failure);
    if (!job.activityRecorded) {
      this.recordHomeActivity({
        type: job.kind === 'agent' ? 'agent_generation' : 'generation',
        status: 'failed',
        startedAt: job.payload?.startedAt,
        generation: {
          difficulty: generation.difficulty,
          challenge: generation.challenge,
          wordCount: generation.wordCount,
          topic: job.payload?.topic
        },
        failureReason: failure.message
      });
    }
    runtime.updateJob({ failureId, activityRecorded: true });
  },

  async executeSingleGenerationJob(job, runtime) {
    const payload = job.payload || {};
    const generation = payload.generation || {};
    const generationPolicy = payload.generationPolicy || generationPolicyFor(generation.challenge);
    try {
      let article = await this.findArticleForGenerationJob(job.id);
      let keywords = payload.keywords || '';
      if (!article) {
        const result = await articleGenerationTool.execute({
          request: generation.request,
          difficulty: generation.difficulty,
          challenge: generation.challenge,
          topic: payload.topic,
          wordCount: generation.wordCount
        }, {
          fallbackDifficulty: generation.difficulty,
          fallbackChallenge: generation.challenge,
          fallbackTopic: payload.topic,
          legacyLevel: Config.get('level'),
          learningContext: payload.learningContext || '',
          personalization: generationPolicy.personalization,
          validationOptions: generationPolicy.validationOptions,
          articleFields: { generationJobId: job.id },
          researchSources: payload.researchSources,
          researchSearchedAt: payload.researchSearchedAt,
          researchBrief: payload.researchBrief || '',
          signal: runtime.signal,
          isActive: runtime.isCurrent,
          onProgress: progress => runtime.updateProgress(progress.phase),
          onDraft: draft => runtime.updatePreview({ batchIndex: 0, ...draft })
        });
        article = result.article;
        keywords = result.keywords;
      }
      runtime.updateJob({ articleIds: [...new Set([...(job.articleIds || []), article.id])] });
      if (!runtime.isCurrent()) throw cancelledRequest();
      await this.publishHomeGenerationArticle(job, article, keywords, runtime, 0);
      if (!job.activityRecorded) {
        this.recordHomeActivity({
          type: job.kind === 'agent' ? 'agent_generation' : 'generation',
          status: 'success',
          startedAt: payload.startedAt,
          generation: {
            difficulty: generation.difficulty,
            challenge: generation.challenge,
            wordCount: generation.wordCount,
            topic: payload.topic
          },
          article: this.activityArticle(article)
        });
        runtime.updateJob({ activityRecorded: true });
      }
      if (payload.retryFailureId) this.removeGenerationFailure(payload.retryFailureId);
      return { articleIds: [article.id] };
    } catch (error) {
      if (!runtime.signal.aborted && runtime.isCurrent() && !document.hidden) {
        await this.publishHomeGenerationFailure(job, error, runtime);
      }
      throw error;
    }
  },

  async executeReviewGenerationJob(job, runtime) {
    const payload = job.payload || {};
    const batches = Array.isArray(payload.batches) ? payload.batches : [];
    const generationPolicy = payload.generationPolicy || generationPolicyFor('support');
    const completedBatches = new Set(job.completedBatches || []);
    const failedBatches = new Set(job.failedBatches || []);
    const articleIds = new Set(job.articleIds || []);
    const articles = [];
    const failureReasons = [];

    for (const [index, batch] of batches.entries()) {
      const batchGenerationJobId = `${job.id}:${index}`;
      let article = await this.findArticleForGenerationJob(batchGenerationJobId);
      if (completedBatches.has(index) && article) {
        articles.push(article);
        articleIds.add(article.id);
        continue;
      }
      const coveredCount = articles.reduce((total, item) => total + (item.usedWords?.length || 0), 0);
      runtime.updateProgress(`review-正在制作第 ${index + 1}/${batches.length} 篇，已覆盖 ${coveredCount} 个词…`);
      const wordCount = 220;
      const request = `请生成一篇短篇复习阅读，自然融入以下词汇：${batch.join(', ')}。${index > 0 ? '请选择与上一篇不同的主题。' : ''}`;
      try {
        if (!article) {
          const result = await articleGenerationTool.execute({
            request,
            difficulty: payload.difficulty,
            topic: payload.topic,
            wordCount
          }, {
            fallbackDifficulty: payload.difficulty,
            fallbackTopic: payload.topic,
            fallbackChallenge: 'support',
            learningContext: payload.learningContext || '',
            personalization: generationPolicy.personalization,
            validationOptions: generationPolicy.validationOptions,
            signal: runtime.signal,
            isActive: runtime.isCurrent,
            targetWords: batch,
            reviewMaxWords: 280,
            articleFields: { reviewMode: true, usedWords: batch, generationJobId: batchGenerationJobId },
            onDraft: draft => runtime.updatePreview({
              batchIndex: index,
              ...draft
            }),
            onProgress: progress => runtime.updateProgress(`review-${generationProgressLabel(progress)}`)
          });
          article = result.article;
        }
        if (!runtime.isCurrent()) throw cancelledRequest();
        completedBatches.add(index);
        failedBatches.delete(index);
        articleIds.add(article.id);
        runtime.updateJob({
          completedBatches: [...completedBatches],
          failedBatches: [...failedBatches],
          articleIds: [...articleIds]
        });
        articles.push(article);
        await this.publishHomeGenerationArticle(job, article, '', runtime, index);
      } catch (error) {
        if (!runtime.isCurrent() || runtime.signal.aborted || isCancelledGenerationRequest(error)) throw error;
        if (document.hidden) throw error;
        failedBatches.add(index);
        runtime.updateJob({ failedBatches: [...failedBatches], articleIds: [...articleIds] });
        const failure = this.createGenerationFailure(error, {
          request,
          difficulty: payload.difficulty,
          challenge: 'support',
          wordCount
        }, payload.topic);
        failure.generationJobId = batchGenerationJobId;
        failure.message = `第 ${index + 1} 篇未完成：${failure.message}`;
        failureReasons.push(failure.message);
        if (!this.hasPublishedGenerationFailure(batchGenerationJobId)) this.addGenerationFailure(failure);
      }
    }

    const coveredCount = articles.reduce((total, article) => total + (article.usedWords?.length || 0), 0);
    const coveredKeys = new Set(
      articles.flatMap(article => normalizeTargetWords(article.usedWords, Number.POSITIVE_INFINITY)
        .map(word => word.toLocaleLowerCase('en-US')))
    );
    const remainingWordCount = normalizeTargetWords(payload.normalizedWords, Number.POSITIVE_INFINITY)
      .filter(word => !coveredKeys.has(word.toLocaleLowerCase('en-US'))).length;
    const failedWordCount = [...failedBatches].reduce((total, index) => total + (batches[index]?.length || 0), 0);
    if (!job.activityRecorded) {
      this.recordHomeActivity({
        type: 'review_generation',
        status: articles.length && !failedWordCount ? 'success' : articles.length ? 'partial_success' : 'failed',
        startedAt: payload.startedAt,
        generation: { difficulty: payload.difficulty, challenge: 'support', topic: payload.topic, articleCount: batches.length },
        articles: articles.map(article => this.activityArticle(article)),
        coveredWordCount: coveredCount,
        failedWordCount,
        failureReason: failureReasons.join('；')
      });
      runtime.updateJob({ activityRecorded: true });
      if (articles.length) this.addMessage('system', `📝 已生成 ${articles.length} 篇巩固阅读，覆盖 ${coveredCount} 个词${remainingWordCount ? `，仍有 ${remainingWordCount} 个词待继续生成` : ''}。点击卡片即可开始阅读。`);
      else if (failedWordCount) this.addMessage('error', '本次复习阅读未能完成，请通过下方入口重试。');
      if (remainingWordCount > 0) {
        this.addReviewContinueAction(remainingWordCount, () => this.generateReviewReadings({
          reviewWords: payload.normalizedWords,
          difficulty: payload.difficulty,
          topic: payload.topic,
          sourceLabel: payload.sourceLabel
        }));
      }
    }
    return { articleIds: [...articleIds] };
  },

  async executeHomeGenerationJob(job, runtime) {
    if (job.kind === 'review') return this.executeReviewGenerationJob(job, runtime);
    return this.executeSingleGenerationJob(job, runtime);
  },

  resetGenerateButton() {
    const generateButton = document.getElementById('generateBtn');
    if (!generateButton) return;
    generateButton.disabled = false;
    generateButton.textContent = '↑';
    generateButton.setAttribute('aria-label', '发送问题');
  },

  ensureTargetTrackBeforeGeneration() {
    if (!requiresTargetTrackSelection(Config.get('exam_level'), Config.get('target_track_selection_required'))) {
      return false;
    }
    this.addMessage('system', '开始生成前，请先在「3 分钟阅读校准」中选择四级、六级、考研英语一或考研英语二；初测可以稍后跳过，但目标考试需要由你确认。');
    location.hash = '#/assessment';
    return true;
  },

  // Only direct user choices reach this method. Tool preferences never set
  // `targetSelectionRequested`, so the learner-owned target remains stable.
  commitGenerationTargetSelection(generation) {
    const target = normalizeSelectableTrack(generation?.targetSelectionRequested);
    if (!target) return false;
    Config.set('exam_level', target);
    Config.set('target_track_selection_required', 'false');
    return true;
  },

  // The resolver is shared with Agent calls, but only text typed directly by
  // the learner may update the persisted target exam. Tool-provided prompts
  // remain useful generation instructions without becoming target choices.
  resolveDirectGenerationRequest({
    request = '',
    selectedDifficulty,
    selectedChallenge,
    legacyLevel,
    toolDifficulty,
    toolWordCount,
    allowExplicitUserTarget = false
  } = {}) {
    const directRequest = String(request || '').trim();
    const generation = resolveGenerationRequest({
      request: directRequest,
      selectedDifficulty,
      selectedChallenge,
      legacyLevel,
      toolDifficulty,
      toolWordCount,
      allowExplicitUserTarget
    });
    generation.request = directRequest;
    if (allowExplicitUserTarget) this.commitGenerationTargetSelection(generation);
    return generation;
  },

  studyAnchorMarkup() {
    const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date());
    return `<section class="chat-study-intro" aria-label="今日学习">
      <div class="chat-study-strip"><span><i class="fa-solid fa-book-open" aria-hidden="true"></i> 今日学习</span><time>${today}</time></div>
      <div class="chat-study-copy"><p>从一个问题开始</p><span>对话、生成阅读与复习，都在同一条学习线里继续。</span></div>
    </section>`;
  },

  getImageService() {
    return this.imageService || imageService;
  },

  async restoreImageState() {
    const service = this.getImageService();
    await service.retryRemoteDeletes().catch(() => {});
    const draft = await service.restoreDraft('home').catch(() => null);
    if (draft?.groupId) {
      this.imageDraftGroupId = draft.groupId;
      this.imageDraftState = draft.attachments.some(row => ['processing', 'uploading'].includes(row.status))
        ? 'processing'
        : draft.attachments.some(row => row.lastError) ? 'error' : 'ready';
      await this.renderImageDraft(draft.groupId);
    }
    const referenced = conversationStore.getSession('home').messages
      .flatMap(message => Array.isArray(message.imageGroup?.attachmentIds) ? message.imageGroup.attachmentIds : []);
    await service.collectOrphans(referenced, {
      protectedAttachmentIds: draft?.attachments?.map(row => row.id) || []
    }).catch(() => {});
    const imageMessages = conversationStore.getSession('home').messages
      .filter(message => message.imageGroup?.groupId)
      .reverse();
    this.activeImageGroupId = null;
    for (const message of imageMessages) {
      const rows = await DB.getChatImageGroup(message.imageGroup.groupId).catch(() => []);
      if (rows.length && rows.some(row => !row.detached)) {
        this.activeImageGroupId = message.imageGroup.groupId;
        await service.attachGroup(this.activeImageGroupId).catch(() => {});
        break;
      }
    }
    await this.renderActiveImageChip();
    this.updateImageSendState();
  },

  async renderActiveImageChip() {
    const chip = document.getElementById('chatActiveImageChip');
    if (!chip) return;
    if (!this.activeImageGroupId) {
      chip.hidden = true;
      chip.replaceChildren();
      return;
    }
    const rows = await DB.getChatImageGroup(this.activeImageGroupId).catch(() => []);
    if (!rows.length) {
      this.activeImageGroupId = null;
      chip.hidden = true;
      chip.replaceChildren();
      return;
    }
    chip.innerHTML = `<span><i class="fa-solid fa-images" aria-hidden="true"></i> 当前图片 · ${rows.length}张</span>
      <button type="button" data-chat-image-detach aria-label="退出当前图片话题">×</button>`;
    chip.hidden = false;
  },

  async activateImageGroup(groupId, { focus = true } = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) return false;
    const service = this.getImageService();
    if (this.activeImageGroupId && this.activeImageGroupId !== normalizedGroupId) {
      await service.detachGroup(this.activeImageGroupId).catch(() => {});
    }
    const group = await service.attachGroup(normalizedGroupId).catch(() => null);
    if (!group?.attachments?.length) return false;
    this.activeImageGroupId = normalizedGroupId;
    await this.renderActiveImageChip();
    if (focus) document.getElementById('promptInput')?.focus();
    return true;
  },

  async detachActiveImageGroup() {
    const groupId = this.activeImageGroupId;
    if (groupId) await this.getImageService().detachGroup(groupId).catch(() => {});
    this.activeImageGroupId = null;
    await this.renderActiveImageChip();
  },

  revokeImageObjectUrls() {
    for (const url of this._imageDraftObjectUrls.values()) {
      try { globalThis.URL?.revokeObjectURL(url); } catch {}
    }
    this._imageDraftObjectUrls.clear();
    this._imageViewerCleanup?.();
    this._imageViewerCleanup = null;
  },

  showImageActionSheet(force) {
    const sheet = document.getElementById('chatImageActionSheet');
    const button = document.getElementById('composerImageBtn');
    if (!sheet || !button) return;
    const open = force ?? sheet.hidden;
    sheet.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  },

  async handleImageFiles(files, source = 'gallery') {
    const selected = Array.from(files || []).filter(Boolean);
    const maxImagesPerMessage = chatImagePolicy.CHAT_IMAGE_LIMITS.maxImagesPerMessage;
    if (!selected.length) return;
    const service = this.getImageService();
    const previousGroupId = this.imageDraftGroupId;
    this.imageDraftState = 'processing';
    try {
      const previousRows = previousGroupId
        ? await DB.getChatImageGroup(previousGroupId).catch(() => [])
        : [];
      const reusableRows = previousRows.filter(row => row.blob).map(row => row.blob);
      const availableSlots = Math.max(0, maxImagesPerMessage - reusableRows.length);
      const accepted = selected.slice(0, availableSlots);
      if (!accepted.length) throw new Error('too_many_images');
      const omittedCount = selected.length - accepted.length;
      const nextGroup = await service.createDraft([...reusableRows, ...accepted], {
        conversationKey: 'home',
        source
      });
      if (previousGroupId && previousGroupId !== nextGroup.groupId) {
        await service.deleteGroup(previousGroupId).catch(() => {});
      }
      this.imageDraftGroupId = nextGroup.groupId;
      this.imageDraftState = 'ready';
      await this.renderImageDraft(nextGroup.groupId);
      if (omittedCount > 0) {
        this.appendConversation({
          role: 'assistant',
          kind: 'notice',
          content: `一次最多添加 ${maxImagesPerMessage} 张图片，已保留前 ${accepted.length} 张，其余 ${omittedCount} 张未加入。`
        });
      }
    } catch (error) {
      this.imageDraftState = 'error';
      const message = error?.code === 'too_many_images' || error?.message === 'too_many_images'
        ? `一次最多添加 ${maxImagesPerMessage} 张图片。`
        : error?.code === 'image_storage_capacity_exceeded'
          ? '本地图片空间不足，当前草稿和正在使用的图片不会被清理，请分批发送或先清空对话图片。'
        : '图片处理失败，请重试或换一张图片。';
      this.appendConversation({ role: 'assistant', kind: 'error', content: message });
      await this.renderImageDraft(this.imageDraftGroupId);
    } finally {
      this.updateImageSendState();
    }
  },

  async renderImageDraft(groupId) {
    const strip = document.getElementById('chatImageDraftStrip');
    if (!strip) return;
    // History galleries own the `history:` entries in the same map. Re-rendering
    // the composer must release only the current draft previews.
    this.clearDraftPreviewUrls();
    const rows = groupId ? await DB.getChatImageGroup(groupId).catch(() => []) : [];
    if (!rows.length) {
      strip.hidden = true;
      strip.replaceChildren();
      if (groupId === this.imageDraftGroupId) {
        this.imageDraftGroupId = null;
        this.imageDraftState = 'idle';
      }
      this.updateImageSendState();
      return;
    }
    strip.hidden = false;
    strip.dataset.maxImagesPerMessage = String(chatImagePolicy.CHAT_IMAGE_LIMITS.maxImagesPerMessage);
    strip.innerHTML = rows.map(row => {
      const source = row.thumbnailBlob || row.blob;
      let previewUrl = '';
      if (source && typeof globalThis.URL?.createObjectURL === 'function') {
        previewUrl = globalThis.URL.createObjectURL(source);
        this._imageDraftObjectUrls.set(row.id, previewUrl);
      }
      const errorLabel = row.lastError ? '处理失败' : row.status === 'uploading' ? '上传中' : '';
      return `<article class="chat-image-draft-item" draggable="true" data-chat-image-draft-id="${esc(row.id)}" data-image-order="${Number(row.order) || 0}">
        <button class="chat-image-thumb" type="button" data-chat-image-preview="${esc(row.id)}" aria-label="预览第 ${Number(row.order) + 1} 张图片">
          ${previewUrl ? `<img src="${esc(previewUrl)}" alt="第 ${Number(row.order) + 1} 张图片预览">` : '<span class="chat-image-placeholder" aria-hidden="true"><i class="fa-solid fa-image"></i></span>'}
        </button>
        <button type="button" class="chat-image-order" data-chat-image-drag-handle aria-label="拖动调整第 ${Number(row.order) + 1} 张图片顺序">${Number(row.order) + 1}</button>
        ${errorLabel ? `<span class="chat-image-status" role="status">${errorLabel}</span>` : ''}
        ${row.lastError ? `<button type="button" class="chat-image-retry" data-chat-image-retry="${esc(row.id)}">重试</button>` : ''}
        <button type="button" class="chat-image-remove" data-chat-image-remove="${esc(row.id)}" aria-label="移除第 ${Number(row.order) + 1} 张图片">×</button>
        <button type="button" class="chat-image-move" data-chat-image-move="up" data-chat-image-id="${esc(row.id)}" aria-label="上移">↑</button>
        <button type="button" class="chat-image-move" data-chat-image-move="down" data-chat-image-id="${esc(row.id)}" aria-label="下移">↓</button>
      </article>`;
    }).join('');
    this.updateImageSendState(rows);
  },

  async retryImageDraft(id) {
    const row = await DB.getChatImageAttachment(id).catch(() => null);
    if (!row) return;
    await DB.updateChatImageAttachment(id, { status: 'draft', lastError: null, updatedAt: Date.now() });
    this.imageDraftState = 'ready';
    await this.renderImageDraft(row.groupId);
  },

  async moveImageDraft(id, direction) {
    const groupId = this.imageDraftGroupId;
    if (!groupId) return;
    const rows = (await DB.getChatImageGroup(groupId).catch(() => [])).sort((a, b) => (a.order || 0) - (b.order || 0));
    const index = rows.findIndex(row => row.id === id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    await this.getImageService().reorderDraft(groupId, rows.map(row => row.id));
    await this.renderImageDraft(groupId);
  },

  async reorderImageDraft(sourceId, targetId) {
    const groupId = this.imageDraftGroupId;
    if (!groupId || !sourceId || !targetId || sourceId === targetId) return;
    const rows = (await DB.getChatImageGroup(groupId).catch(() => []))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const sourceIndex = rows.findIndex(row => row.id === sourceId);
    const targetIndex = rows.findIndex(row => row.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = rows.splice(sourceIndex, 1);
    rows.splice(targetIndex, 0, moved);
    await this.getImageService().reorderDraft(groupId, rows.map(row => row.id));
    await this.renderImageDraft(groupId);
  },

  async openImageViewer(id, { groupId = this.imageDraftGroupId } = {}) {
    const rows = groupId
      ? await DB.getChatImageGroup(groupId).catch(() => [])
      : [await DB.getChatImageAttachment(id).catch(() => null)].filter(Boolean);
    if (!rows.length) return;
    let index = Math.max(0, rows.findIndex(row => row.id === id));
    let url = '';
    let scale = 1;
    this._imageViewerCleanup?.();
    const viewer = document.createElement('div');
    viewer.className = 'chat-image-viewer';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', '图片查看器');
    viewer.innerHTML = `<button type="button" class="chat-image-viewer-close" data-chat-image-viewer="close" aria-label="关闭图片预览">×</button>
      <div class="chat-image-viewer-stage"><img alt="图片预览"></div>
      <div class="chat-image-viewer-toolbar" aria-label="图片查看控制">
        <button type="button" data-chat-image-viewer="previous" aria-label="上一张">‹</button>
        <button type="button" data-chat-image-viewer="zoom-out" aria-label="缩小">−</button>
        <span data-chat-image-viewer-counter></span>
        <button type="button" data-chat-image-viewer="zoom-in" aria-label="放大">＋</button>
        <button type="button" data-chat-image-viewer="next" aria-label="下一张">›</button>
        ${groupId && groupId !== this.imageDraftGroupId ? '<button type="button" class="chat-image-viewer-continue" data-chat-image-viewer="continue">继续询问这组图片</button>' : ''}
      </div>`;
    const image = viewer.querySelector('img');
    const show = nextIndex => {
      index = Math.max(0, Math.min(rows.length - 1, nextIndex));
      if (url) {
        try { globalThis.URL?.revokeObjectURL(url); } catch {}
        url = '';
      }
      const row = rows[index];
      const source = row?.blob || row?.thumbnailBlob;
      if (source && typeof globalThis.URL?.createObjectURL === 'function') {
        url = globalThis.URL.createObjectURL(source);
        image.src = url;
        image.alt = `第 ${index + 1} 张图片预览`;
      } else {
        image.removeAttribute('src');
        image.alt = '原图已释放';
      }
      scale = 1;
      image.style.transform = 'scale(1)';
      viewer.querySelector('[data-chat-image-viewer-counter]').textContent = `${index + 1} / ${rows.length}`;
      viewer.querySelector('[data-chat-image-viewer="previous"]').disabled = index === 0;
      viewer.querySelector('[data-chat-image-viewer="next"]').disabled = index === rows.length - 1;
    };
    const zoom = delta => {
      scale = Math.max(0.75, Math.min(3, scale + delta));
      image.style.transform = `scale(${scale})`;
    };
    const close = () => {
      viewer.remove();
      if (url) {
        try { globalThis.URL?.revokeObjectURL(url); } catch {}
      }
      document.removeEventListener('keydown', onKey);
      this._imageViewerCleanup = null;
    };
    const onKey = event => {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowLeft') show(index - 1);
      if (event.key === 'ArrowRight') show(index + 1);
      if (event.key === '+' || event.key === '=') zoom(0.25);
      if (event.key === '-') zoom(-0.25);
    };
    viewer.addEventListener('click', event => {
      if (event.target === viewer) return close();
      const action = event.target.closest('[data-chat-image-viewer]')?.dataset.chatImageViewer;
      if (action === 'close') close();
      if (action === 'previous') show(index - 1);
      if (action === 'next') show(index + 1);
      if (action === 'zoom-in') zoom(0.25);
      if (action === 'zoom-out') zoom(-0.25);
      if (action === 'continue' && groupId) {
        void this.activateImageGroup(groupId).then(close);
      }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(viewer);
    show(index);
    this._imageViewerCleanup = close;
  },

  updateImageSendState(rows = null) {
    const button = document.getElementById('generateBtn');
    if (!button) return;
    const currentRows = rows || (this.imageDraftGroupId ? [] : []);
    const processing = this.imageDraftState === 'processing'
      || currentRows.some(row => ['processing', 'uploading'].includes(row.status));
    if (processing) {
      button.disabled = true;
      button.setAttribute('aria-label', '图片处理中');
    } else if (!this.imageDraftGroupId) {
      button.disabled = false;
      button.setAttribute('aria-label', '发送问题');
    } else {
      button.disabled = false;
      button.setAttribute('aria-label', '发送图片问题');
    }
  },

  async renderImageGallery(node, imageGroup, messageId = '') {
    if (!node || !imageGroup?.groupId) return;
    const rows = await DB.getChatImageGroup(imageGroup.groupId).catch(() => []);
    const container = document.getElementById('chatMessages');
    // A slow image read may finish after Store-driven compaction detached the
    // message. Do not create a new URL or listener for a stale node.
    if (!rows.length || !container?.contains(node)) return;
    const gallery = document.createElement('div');
    gallery.className = 'chat-image-message-grid';
    gallery.setAttribute('aria-label', `图片 ${Math.min(rows.length, 12)} 张`);
    rows.slice(0, 4).forEach((row, index) => {
      const source = row.thumbnailBlob || row.blob;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chat-image-thumb chat-image-message-thumb';
      button.dataset.chatImagePreview = row.id;
      button.setAttribute('aria-label', `查看第 ${index + 1} 张图片`);
      if (source && typeof globalThis.URL?.createObjectURL === 'function') {
        const url = globalThis.URL.createObjectURL(source);
        this._imageDraftObjectUrls.set(`history:${messageId || imageGroup.groupId}:${row.id}`, url);
        button.innerHTML = `<img src="${esc(url)}" alt="第 ${index + 1} 张图片">`;
      } else {
        button.innerHTML = '<span class="chat-image-placeholder"><i class="fa-solid fa-image" aria-hidden="true"></i><small>原图已释放</small></span>';
      }
      button.addEventListener('click', () => {
        void this.activateImageGroup(imageGroup.groupId, { focus: false })
          .then(() => this.openImageViewer(row.id, { groupId: imageGroup.groupId }));
      });
      gallery.appendChild(button);
    });
    if (rows.length > 4) {
      const more = document.createElement('span');
      more.className = 'chat-image-more-count';
      more.textContent = `+${rows.length - 4}`;
      gallery.appendChild(more);
    }
    node.appendChild(gallery);
  },

  // Show pending articles that were generated while user was away
  showPendingArticles() {
    const pending = PendingArticles.getAll();
    pending.forEach(({ article, reviewKeywords }) => {
      this.addArticleCard(article);
      if (reviewKeywords) {
        this.addMessage('system', `已自动融入我的词汇中的单词：${reviewKeywords}`);
      }
    });
  },

  // Bind event listeners
  bindEvents() {
    document.getElementById('generateBtn').addEventListener('click', () => this.submitComposer());

    document.getElementById('promptInput').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._guidedReplyTarget) {
        e.preventDefault();
        this.clearGuidedLearningReply();
        return;
      }
      if (e.key === 'Escape' && this._chatFollowUpExcerpt) {
        e.preventDefault();
        this.clearChatFollowUp();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitComposer();
      }
    });
    document.getElementById('chatFollowUpClear')?.addEventListener('click', () => this.clearChatFollowUp());
    document.getElementById('guidedLearningReplyClear')?.addEventListener('click', () => this.clearGuidedLearningReply());

    const messages = document.getElementById('chatMessages');
    this._messageCopyCleanup = bindMessageCopy(messages);
    this._chatSelectionActions = new ChatSelectionActions({
      root: messages,
      onAsk: excerpt => this.setChatFollowUp(excerpt)
    });
    this._chatSelectionActions.bind();
    if (messages?.querySelector('[data-learning-text="click"]')) {
      void this.ensureLearningTextLookup(messages);
    }
    const onGuidedAction = event => {
      const learningMode = event.target.closest('[data-learning-mode]');
      if (learningMode) {
        void this.handleLearningModeChoice(learningMode);
        return;
      }
      const guidedAction = event.target.closest('[data-guided-action]');
      if (guidedAction) {
        void this.handleGuidedLearningAction(guidedAction);
        return;
      }
      const failureAction = event.target.closest('[data-guided-failure-action]');
      if (failureAction) void this.handleGuidedLearningFailureAction(failureAction);
    };
    messages?.addEventListener('click', onGuidedAction);
    this._guidedActionCleanup = () => messages?.removeEventListener('click', onGuidedAction);

    const imageButton = document.getElementById('composerImageBtn');
    const imageSheet = document.getElementById('chatImageActionSheet');
    const cameraInput = document.getElementById('chatCameraInput');
    const galleryInput = document.getElementById('chatGalleryInput');
    const activeImageChip = document.getElementById('chatActiveImageChip');
    const onImageButtonClick = () => this.showImageActionSheet();
    const onImageSheetClick = event => {
      const action = event.target.closest('[data-image-action]')?.dataset.imageAction;
      if (!action) return;
      this.showImageActionSheet(false);
      if (action === 'cancel') return;
      const input = action === 'camera' ? cameraInput : galleryInput;
      if (input) input.click();
    };
    const onFiles = (event, source) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      void this.handleImageFiles(files, source);
    };
    const onCameraFiles = event => onFiles(event, 'camera');
    const onGalleryFiles = event => onFiles(event, 'gallery');
    const onActiveImageClick = event => {
      if (event.target.closest('[data-chat-image-detach]')) void this.detachActiveImageGroup();
    };
    const draftStrip = document.getElementById('chatImageDraftStrip');
    let draggedImageId = null;
    let pointerDrag = null;
    const clearDraftDragState = () => {
      draftStrip?.querySelectorAll('.is-dragging, .is-drag-target').forEach(node => {
        node.classList.remove('is-dragging', 'is-drag-target');
      });
      draggedImageId = null;
      pointerDrag = null;
    };
    const onDraftClick = event => {
      const removeId = event.target.closest('[data-chat-image-remove]')?.dataset.chatImageRemove;
      if (removeId) {
        void this.getImageService().removeDraftImage(removeId).then(() => this.renderImageDraft(this.imageDraftGroupId));
        return;
      }
      const retryId = event.target.closest('[data-chat-image-retry]')?.dataset.chatImageRetry;
      if (retryId) {
        void this.retryImageDraft(retryId);
        return;
      }
      const previewId = event.target.closest('[data-chat-image-preview]')?.dataset.chatImagePreview;
      if (previewId) {
        void this.openImageViewer(previewId);
        return;
      }
      const move = event.target.closest('[data-chat-image-move]');
      if (move) void this.moveImageDraft(move.dataset.chatImageId, move.dataset.chatImageMove);
    };
    const onDraftDragStart = event => {
      const item = event.target.closest('[data-chat-image-draft-id]');
      if (!item || (event.target.closest('button') && !event.target.closest('[data-chat-image-drag-handle]'))) {
        event.preventDefault();
        return;
      }
      draggedImageId = item.dataset.chatImageDraftId;
      item.classList.add('is-dragging');
      event.dataTransfer?.setData('text/plain', draggedImageId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    };
    const onDraftDragOver = event => {
      if (!draggedImageId) return;
      const item = event.target.closest('[data-chat-image-draft-id]');
      if (!item) return;
      event.preventDefault();
      draftStrip?.querySelector('.is-drag-target')?.classList.remove('is-drag-target');
      if (item.dataset.chatImageDraftId !== draggedImageId) item.classList.add('is-drag-target');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    };
    const onDraftDrop = event => {
      const targetId = event.target.closest('[data-chat-image-draft-id]')?.dataset.chatImageDraftId;
      const sourceId = draggedImageId || event.dataTransfer?.getData('text/plain');
      event.preventDefault();
      clearDraftDragState();
      if (sourceId && targetId && sourceId !== targetId) void this.reorderImageDraft(sourceId, targetId);
    };
    const onDraftDragEnd = () => clearDraftDragState();
    const onDraftPointerDown = event => {
      const handle = event.target.closest('[data-chat-image-drag-handle]');
      const item = handle?.closest('[data-chat-image-draft-id]');
      if (!handle || !item) return;
      event.preventDefault();
      pointerDrag = {
        pointerId: event.pointerId,
        sourceId: item.dataset.chatImageDraftId,
        targetId: item.dataset.chatImageDraftId,
        handle
      };
      item.classList.add('is-dragging');
      handle.setPointerCapture?.(event.pointerId);
    };
    const onDraftPointerMove = event => {
      if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
      event.preventDefault();
      const item = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-chat-image-draft-id]');
      if (!item) return;
      draftStrip?.querySelector('.is-drag-target')?.classList.remove('is-drag-target');
      pointerDrag.targetId = item.dataset.chatImageDraftId;
      if (pointerDrag.targetId !== pointerDrag.sourceId) item.classList.add('is-drag-target');
    };
    const finishDraftPointerDrag = event => {
      if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
      const { sourceId, targetId, handle, pointerId } = pointerDrag;
      handle.releasePointerCapture?.(pointerId);
      clearDraftDragState();
      if (sourceId !== targetId) void this.reorderImageDraft(sourceId, targetId);
    };
    imageButton?.addEventListener('click', onImageButtonClick);
    imageSheet?.addEventListener('click', onImageSheetClick);
    cameraInput?.addEventListener('change', onCameraFiles);
    galleryInput?.addEventListener('change', onGalleryFiles);
    activeImageChip?.addEventListener('click', onActiveImageClick);
    draftStrip?.addEventListener('click', onDraftClick);
    draftStrip?.addEventListener('dragstart', onDraftDragStart);
    draftStrip?.addEventListener('dragover', onDraftDragOver);
    draftStrip?.addEventListener('drop', onDraftDrop);
    draftStrip?.addEventListener('dragend', onDraftDragEnd);
    draftStrip?.addEventListener('pointerdown', onDraftPointerDown);
    draftStrip?.addEventListener('pointermove', onDraftPointerMove);
    draftStrip?.addEventListener('pointerup', finishDraftPointerDrag);
    draftStrip?.addEventListener('pointercancel', finishDraftPointerDrag);
    this._imageActionCleanup = () => {
      imageButton?.removeEventListener('click', onImageButtonClick);
      imageSheet?.removeEventListener('click', onImageSheetClick);
      cameraInput?.removeEventListener('change', onCameraFiles);
      galleryInput?.removeEventListener('change', onGalleryFiles);
      activeImageChip?.removeEventListener('click', onActiveImageClick);
      draftStrip?.removeEventListener('click', onDraftClick);
      draftStrip?.removeEventListener('dragstart', onDraftDragStart);
      draftStrip?.removeEventListener('dragover', onDraftDragOver);
      draftStrip?.removeEventListener('drop', onDraftDrop);
      draftStrip?.removeEventListener('dragend', onDraftDragEnd);
      draftStrip?.removeEventListener('pointerdown', onDraftPointerDown);
      draftStrip?.removeEventListener('pointermove', onDraftPointerMove);
      draftStrip?.removeEventListener('pointerup', finishDraftPointerDrag);
      draftStrip?.removeEventListener('pointercancel', finishDraftPointerDrag);
      clearDraftDragState();
    };
    const clearContextButton = document.getElementById('appClearContextBtn');
    if (clearContextButton) {
      this._clearContextHandler = () => { void this.clearHistory(); };
      clearContextButton.addEventListener('click', this._clearContextHandler);
    }

    document.getElementById('quickActionRail').addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      const { action: name, topic } = action.dataset;
      if (['random', 'review'].includes(name)) {
        this.clearGuidedLearningReply();
        this.skipPendingLearningChoices();
        this.pauseActiveGuidedSessions();
      }
      if (name === 'random') {
        document.getElementById('promptInput').value = '';
        this.handleGenerate();
      } else if (name === 'review') {
        this.handleReviewGenerate();
      } else if (name === 'topic') {
        const selectedTopic = this.topics.find(item => item.value === topic)?.label || topic;
        document.getElementById('promptInput').value = `请生成一篇关于${selectedTopic}的英语阅读文章。`;
        document.getElementById('promptInput').focus();
      } else if (name === 'import-article') {
        Modal.showImport();
      } else if (name === 'import-words') {
        WordImport.showModal();
      } else if (name === 'daily-report') {
        void this.handleDailyReport();
      }
    });
  },

  setChatFollowUp(excerpt) {
    const selectedExcerpt = normalizeSelectedExcerpt(excerpt);
    if (!selectedExcerpt) return this.clearChatFollowUp();
    this.clearGuidedLearningReply();
    this._chatFollowUpExcerpt = selectedExcerpt;
    const chip = document.getElementById('chatFollowUpChip');
    const text = document.getElementById('chatFollowUpText');
    if (text) text.textContent = selectedExcerpt;
    if (chip) chip.hidden = false;
    document.querySelector('#promptInput')?.focus();
  },

  clearChatFollowUp(expectedExcerpt = null) {
    if (expectedExcerpt && expectedExcerpt !== this._chatFollowUpExcerpt) return false;
    this._chatFollowUpExcerpt = '';
    const chip = document.getElementById('chatFollowUpChip');
    const text = document.getElementById('chatFollowUpText');
    if (text) text.textContent = '';
    if (chip) chip.hidden = true;
    return true;
  },

  async ensureLearningTextLookup(root = document.getElementById('chatMessages')) {
    if (!root || this._learningTextLookupCleanup) return this._learningTextLookupCleanup;
    if (this._learningTextLookupPromise && this._learningTextLookupRoot === root) {
      return this._learningTextLookupPromise;
    }
    this._learningTextLookupRoot = root;
    const request = import('../components/reading-word-lookup.js')
      .then(({ bindLearningTextLookup }) => {
        if (this._learningTextLookupRoot !== root) return null;
        this._learningTextLookupCleanup = bindLearningTextLookup({
          root,
          getContextSentence: event => event.target?.closest?.('.guided-learning-card')?.textContent || '',
          lookupContext: { source: 'home-guided-learning' }
        });
        return this._learningTextLookupCleanup;
      })
      .catch(error => {
        console.warn('Guided learning word lookup failed to load.', error);
        return null;
      })
      .finally(() => {
        if (this._learningTextLookupPromise === request) this._learningTextLookupPromise = null;
      });
    this._learningTextLookupPromise = request;
    return request;
  },

  releaseChatActions() {
    this._messageCopyCleanup?.();
    this._messageCopyCleanup = null;
    this._chatSelectionActions?.destroy?.();
    this._chatSelectionActions = null;
    this._imageActionCleanup?.();
    this._imageActionCleanup = null;
    this._imageViewerCleanup?.();
    this._imageViewerCleanup = null;
    this._guidedActionCleanup?.();
    this._guidedActionCleanup = null;
    this._learningTextLookupCleanup?.();
    this._learningTextLookupCleanup = null;
    this._learningTextLookupRoot = null;
    this.revokeImageObjectUrls();
    this._chatFollowUpExcerpt = '';
    this._guidedReplyTarget = null;
  },

  homeConversationMessages() {
    return conversationStore.getSession('home').messages || [];
  },

  homeMessageIdentity(message) {
    if (!message || typeof message !== 'object') return '';
    return conversationStore.messageIdentity(message, 0, 'home');
  },

  compactHomeConversationDOM(retainedMessageIds = []) {
    const container = document.getElementById('chatMessages');
    if (!container) return [];
    let releasedImageUrls = 0;
    const removed = compactPersistentHomeMessageNodes({
      nodes: container.querySelectorAll('[data-home-message-id]'),
      retainedMessageIds,
      onRemove: node => {
        const removedUrls = collectImageObjectUrls(node);
        const stillUsedUrls = new Set(
          [...container.querySelectorAll('img[src]')]
            .map(image => String(image?.currentSrc || image?.getAttribute?.('src') || image?.src || '').trim())
            .filter(Boolean)
        );
        releasedImageUrls += releaseRemovedImageObjectUrls({
          urlMap: this._imageDraftObjectUrls,
          urls: removedUrls,
          stillUsedUrls
        }).length;
      }
    });
    if (removed.length) {
      diagnosticLogger()?.record('chat.runtime_compacted', {
        category: 'ui',
        payload: { removedMessages: removed.length, releasedImageUrls }
      });
    }
    return removed;
  },

  findHomeMessage(messageId) {
    const stableId = String(messageId || '');
    return this.homeConversationMessages().find(message => this.homeMessageIdentity(message) === stableId) || null;
  },

  findGuidedMessageBySessionId(sessionId) {
    const stableId = String(sessionId || '');
    return this.homeConversationMessages().find(message => (
      message.kind === 'guided_learning' && String(message.session?.id || '') === stableId
    )) || null;
  },

  findHomeMessageElement(messageId) {
    const stableId = String(messageId || '');
    return [...document.querySelectorAll('[data-home-message-id]')]
      .find(element => element.dataset.homeMessageId === stableId) || null;
  },

  addLearningModeChoiceToDOM(message) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const messageId = this.homeMessageIdentity(message);
    const div = document.createElement('div');
    div.className = 'message ai-message learning-mode-choice-message';
    div.dataset.homeMessageId = messageId;
    div.innerHTML = renderLearningModeChoiceCard({ ...message, id: messageId });
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  addGuidedLearningToDOM(value, messageId = '') {
    const container = document.getElementById('chatMessages');
    const session = normalizeGuidedLearningSession(value);
    if (!container || !session) return;
    const stableId = String(messageId || session.id);
    const div = document.createElement('div');
    div.className = 'message ai-message guided-learning-message';
    div.dataset.homeMessageId = stableId;
    div.dataset.guidedSessionId = session.id;
    div.innerHTML = renderGuidedLearningCard(session);
    container.appendChild(div);
    void this.ensureLearningTextLookup(container);
    container.scrollTop = container.scrollHeight;
  },

  addGuidedLearningFailureToDOM(failure, message = {}) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const failureId = this.homeMessageIdentity(message) || nextGuidedLearningId('guided-failure');
    const div = document.createElement('div');
    div.className = 'message ai-message guided-learning-failure-message';
    div.dataset.homeMessageId = failureId;
    div.innerHTML = renderGuidedLearningFailureCard(failure, {
      failureId,
      sourceMessageId: message.sourceMessageId || failure?.sourceMessageId || ''
    });
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  rerenderHomeStructuredMessage(message) {
    const messageId = this.homeMessageIdentity(message);
    const element = this.findHomeMessageElement(messageId);
    if (!element) return false;
    if (message.kind === 'learning_mode_choice') {
      element.innerHTML = renderLearningModeChoiceCard({ ...message, id: messageId });
    } else if (message.kind === 'guided_learning') {
      element.dataset.guidedSessionId = message.session?.id || '';
      element.innerHTML = renderGuidedLearningCard(message.session);
      void this.ensureLearningTextLookup(element.closest?.('#chatMessages') || document.getElementById('chatMessages'));
    } else if (message.kind === 'guided_learning_failure') {
      element.innerHTML = renderGuidedLearningFailureCard(message.failure, {
        failureId: messageId,
        sourceMessageId: message.sourceMessageId || message.failure?.sourceMessageId || ''
      });
    }
    return true;
  },

  replaceHomeStructuredMessage(messageId, replacement) {
    const stableId = String(messageId || '');
    const replaced = conversationStore.replaceMessage('home', message => (
      this.homeMessageIdentity(message) === stableId
    ), message => replacement(message));
    if (!replaced) return null;
    const nextMessage = this.findHomeMessage(stableId);
    if (nextMessage) this.rerenderHomeStructuredMessage(nextMessage);
    return nextMessage;
  },

  replaceGuidedSession(messageId, session) {
    const normalized = normalizeGuidedLearningSession(session);
    if (!normalized) return null;
    return this.replaceHomeStructuredMessage(messageId, message => ({ ...message, session: normalized }));
  },

  addLearningModeChoice(sourceMessageId) {
    const message = {
      id: nextGuidedLearningId('learning-choice'),
      role: 'assistant',
      kind: 'learning_mode_choice',
      sourceMessageId: String(sourceMessageId || ''),
      status: 'pending',
      selectedMode: ''
    };
    this.appendConversation(message);
    return message;
  },

  addGuidedLearning(session) {
    const message = {
      id: nextGuidedLearningId('guided-card'),
      role: 'assistant',
      kind: 'guided_learning',
      session: normalizeGuidedLearningSession(session)
    };
    if (!message.session) return null;
    this.appendConversation(message);
    return message;
  },

  addGuidedLearningFailure(failure = {}, metadata = {}) {
    const message = {
      id: nextGuidedLearningId('guided-failure'),
      role: 'assistant',
      kind: 'guided_learning_failure',
      failure: {
        message: String(failure.message || '互动教学暂时无法生成，请重试或改用详细解析。').slice(0, 500),
        reason: String(failure.reason || 'invalid_response').slice(0, 120)
      },
      ...metadata
    };
    this.appendConversation(message);
    return message;
  },

  removeGuidedLearningFailure(messageId) {
    const stableId = String(messageId || '');
    conversationStore.removeMessages('home', message => (
      message.kind === 'guided_learning_failure' && this.homeMessageIdentity(message) === stableId
    ));
    this.findHomeMessageElement(stableId)?.remove();
  },

  setGuidedLearningReply(messageId, value) {
    const session = normalizeGuidedLearningSession(value);
    const step = session?.steps?.[session.currentStepIndex];
    if (!session || session.status !== 'active' || step?.kind !== 'free_response') return false;
    this.clearChatFollowUp();
    this._guidedReplyTarget = {
      messageId: String(messageId || ''),
      sessionId: session.id,
      expectedRevision: session.revision,
      stepId: step.id
    };
    const chip = document.getElementById('guidedLearningReplyChip');
    const text = document.getElementById('guidedLearningReplyText');
    if (text) text.textContent = step.prompt || step.title;
    if (chip) chip.hidden = false;
    document.getElementById('promptInput')?.focus();
    return true;
  },

  clearGuidedLearningReply() {
    this._guidedReplyTarget = null;
    const chip = document.getElementById('guidedLearningReplyChip');
    const text = document.getElementById('guidedLearningReplyText');
    if (text) text.textContent = '';
    if (chip) chip.hidden = true;
  },

  resolveGuidedReplyTarget() {
    const target = this._guidedReplyTarget;
    if (!target) return null;
    const message = this.findHomeMessage(target.messageId);
    const session = normalizeGuidedLearningSession(message?.session);
    const step = session?.steps?.[session.currentStepIndex];
    if (message?.kind !== 'guided_learning' || !session || session.status !== 'active'
      || session.id !== target.sessionId || session.revision !== target.expectedRevision
      || step?.id !== target.stepId || step.kind !== 'free_response') {
      this.clearGuidedLearningReply();
      return null;
    }
    return { ...target, message, session, step };
  },

  skipPendingLearningChoices() {
    const pending = this.homeConversationMessages().filter(message => (
      message.kind === 'learning_mode_choice' && message.status === 'pending'
    ));
    pending.forEach(message => {
      this.replaceHomeStructuredMessage(this.homeMessageIdentity(message), current => ({
        ...current,
        status: 'skipped'
      }));
    });
  },

  pauseActiveGuidedSessions({ exceptSessionId = '' } = {}) {
    const active = this.homeConversationMessages().filter(message => (
      message.kind === 'guided_learning'
      && message.session?.status === 'active'
      && message.session?.id !== exceptSessionId
    ));
    active.forEach(message => {
      const session = setGuidedLearningStatus(message.session, 'paused');
      this.replaceGuidedSession(this.homeMessageIdentity(message), session);
    });
    if (active.some(message => message.session?.id === this._guidedReplyTarget?.sessionId)) {
      this.clearGuidedLearningReply();
    }
  },

  sourceRequestFor(message) {
    const source = this.findHomeMessage(message?.sourceMessageId);
    return source?.kind === 'text' && source?.role === 'user' ? source : null;
  },

  async launchLearningRequest(mode, sourceMessage) {
    if (!sourceMessage?.content) return;
    if (!Config.hasApiKey()) {
      Modal.showApiSettings();
      return;
    }
    const epoch = this.homeEpoch;
    const requestVersion = this.beginHomeRequest();
    const requestModel = resolveModelForRequest({
      baseUrl: Config.get('base_url'),
      selectedModel: Config.get('model'),
      hasImages: false
    });
    const request = {
      requestText: sourceMessage.content,
      sourceMessageId: this.homeMessageIdentity(sourceMessage),
      epoch,
      requestVersion,
      modelOverride: requestModel.model,
      selectedExcerpt: normalizeSelectedExcerpt(sourceMessage.selectedExcerpt)
    };
    if (mode === 'guided') return this.requestGuidedLearning(request);
    return this.requestDetailedLearning(request);
  },

  async handleLearningModeChoice(button) {
    const wrapper = button.closest('[data-home-message-id]');
    const message = this.findHomeMessage(wrapper?.dataset.homeMessageId);
    const mode = button.dataset.learningMode;
    if (message?.kind !== 'learning_mode_choice' || message.status !== 'pending'
      || !['detailed', 'guided'].includes(mode)) return;
    const source = this.sourceRequestFor(message);
    if (!source) return;
    this.replaceHomeStructuredMessage(this.homeMessageIdentity(message), current => ({
      ...current,
      status: 'resolved',
      selectedMode: mode
    }));
    this.pauseActiveGuidedSessions();
    await this.launchLearningRequest(mode, source);
  },

  async handleGuidedLearningAction(button) {
    const wrapper = button.closest('[data-home-message-id]');
    const messageId = wrapper?.dataset.homeMessageId;
    const message = this.findHomeMessage(messageId);
    const session = normalizeGuidedLearningSession(message?.session);
    const action = button.dataset.guidedAction;
    if (message?.kind !== 'guided_learning' || !session || !action) return;
    const step = session.steps[session.currentStepIndex];
    let next = session;
    if (action === 'previous') next = setGuidedLearningStep(session, session.currentStepIndex - 1);
    else if (action === 'next') next = advanceGuidedLearning(session);
    else if (action === 'hint') next = toggleGuidedLearningHint(session, step.id, !session.hints[step.id]);
    else if (action === 'choose') next = recordGuidedChoice(session, { stepId: step.id, choiceId: button.dataset.guidedChoice });
    else if (action === 'restart') {
      next = setGuidedLearningStatus(session, 'active');
      next = setGuidedLearningStep(next, 0);
    } else if (action === 'resume') {
      this.pauseActiveGuidedSessions({ exceptSessionId: session.id });
      next = setGuidedLearningStatus(session, 'active');
    } else if (action === 'pause') {
      next = setGuidedLearningStatus(session, 'paused');
      this.clearGuidedLearningReply();
    } else if (action === 'answer') {
      this.setGuidedLearningReply(messageId, session);
      return;
    } else if (action === 'detailed') {
      next = setGuidedLearningStatus(session, 'paused');
      this.replaceGuidedSession(messageId, next);
      this.clearGuidedLearningReply();
      const source = this.findHomeMessage(session.sourceMessageId);
      if (source) await this.launchLearningRequest('detailed', source);
      return;
    } else return;
    this.replaceGuidedSession(messageId, next);
  },

  async handleGuidedLearningFailureAction(button) {
    const wrapper = button.closest('[data-home-message-id]');
    const messageId = wrapper?.dataset.homeMessageId;
    const message = this.findHomeMessage(messageId);
    const action = button.dataset.guidedFailureAction;
    if (message?.kind !== 'guided_learning_failure' || !['retry', 'detailed'].includes(action)) return;
    const source = this.findHomeMessage(message.sourceMessageId);
    if (!source) return;
    if (!Config.hasApiKey()) {
      Modal.showApiSettings();
      return;
    }
    this.removeGuidedLearningFailure(messageId);
    if (action === 'detailed') {
      await this.launchLearningRequest('detailed', source);
      return;
    }
    if (message.phase === 'adapt') {
      const guidedMessage = this.findGuidedMessageBySessionId(message.sessionId);
      const session = normalizeGuidedLearningSession(guidedMessage?.session);
      if (!guidedMessage || !session || session.revision !== message.expectedRevision) return;
      const epoch = this.homeEpoch;
      const requestVersion = this.beginHomeRequest();
      await this.requestGuidedAnswer({
        requestText: message.answer,
        target: {
          messageId: this.homeMessageIdentity(guidedMessage),
          sessionId: session.id,
          expectedRevision: session.revision,
          stepId: message.stepId
        },
        session,
        epoch,
        requestVersion,
        modelOverride: resolveModelForRequest({ baseUrl: Config.get('base_url'), selectedModel: Config.get('model'), hasImages: false }).model
      });
      return;
    }
    await this.launchLearningRequest('guided', source);
  },

  async publishHomeAgentReply(reply, requestText = '') {
    if (reply?.content) {
      this.appendConversation({ role: 'assistant', kind: 'text', content: reply.content });
    }
    for (const artifact of reply?.artifacts || []) {
      if (artifact.type === 'article' && !this.hasPublishedGenerationArticle(artifact.article?.generationJobId, artifact.article?.id)) {
        this.addArticleCard(artifact.article);
      }
      if (artifact.type === 'generation_failure' && !this.hasPublishedGenerationFailure(artifact.failure?.generationJobId)) {
        this.addGenerationFailure(this.normalizeGenerationFailure(artifact.failure, requestText));
      }
      if (artifact.type === 'research_sources') {
        this.addResearchSources(artifact);
        this.recordNativeResearchActivity(artifact);
      }
      if (artifact.type === 'app_actions' && artifact.actions?.length) {
        this.addAppActions(artifact.actions);
      }
      if (artifact.type === 'daily_learning_report') {
        await this.publishDailyReportArtifact(artifact);
      }
    }
  },

  async repairGuidedLearningJson({
    phase,
    requestText,
    sourceMessageId,
    session = null,
    target = null,
    modelOverride = null,
    signal = null,
    previousOutput = ''
  }) {
    const isAdapt = phase === 'adapt';
    const system = isAdapt
      ? [
        '你是英语互动教学反馈器。只返回一个 JSON 对象，不要 Markdown，不要解释。',
        '字段必须是 outcome（correct/partial/incorrect）、feedback、nextAction（advance/retry），可选 revisedContent、revisedHint。',
        '只评价当前步骤和学习者这次回答，不得提前泄露后续步骤。'
      ].join('\n')
      : [
        guidedLearningSystemInstruction({ level: Config.get('exam_level'), difficulty: Config.get('reading_mode') }),
        '工具不可用时，只返回一个 JSON 对象，不要 Markdown，不要解释。',
        '对象字段必须是 target、steps、closingSummary。target 含 type/title/text。steps 为 2–7 项，每项含 id/kind/title/content；choice 还需 prompt/choices/correctChoiceId，free_response 还需 prompt。'
      ].join('\n');
    const context = isAdapt
      ? JSON.stringify({
        target: session?.target,
        currentStep: session?.steps?.[session.currentStepIndex],
        learnerAnswer: requestText
      })
      : String(requestText || '');
    let malformed = String(previousOutput || '').slice(0, 2400);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const repairNote = attempt > 0 && malformed
        ? `\n上一次输出未通过结构校验，请修正后重新输出。上次输出：${malformed}`
        : '';
      const response = await API.chat([
        { role: 'system', content: system },
        { role: 'user', content: `${context}${repairNote}` }
      ], {
        signal,
        temperature: 0.2,
        responseFormat: { type: 'json_object' },
        modelOverride
      });
      const raw = String(response?.content || '');
      const parsed = parseGuidedLearningJson(raw);
      if (parsed) {
        try {
          return isAdapt
            ? createGuidedLearningUpdateArtifact(parsed, {
              sessionId: target?.sessionId,
              expectedRevision: target?.expectedRevision,
              stepId: target?.stepId
            })
            : createGuidedLearningArtifact(parsed, {
              sessionId: target?.sessionId,
              sourceMessageId
            });
        } catch {
          // A second bounded repair attempt is allowed below.
        }
      }
      malformed = raw.slice(0, 2400);
    }
    return null;
  },

  async requestDetailedLearning({ requestText, sourceMessageId, epoch, requestVersion, modelOverride, selectedExcerpt = '' }) {
    const isCurrentRequest = () => this.isHomeRequestActive(epoch, requestVersion);
    this.showThinking('正在整理详细解析…');
    try {
      const reply = await chatService.ask({
        sessionKey: 'home',
        session: conversationStore.getContextSession('home'),
        userMessage: requestText,
        modelOverride,
        kind: 'home',
        pageContext: {
          homeLearningMode: 'detailed',
          sourceMessageId,
          ...(selectedExcerpt ? { selectedExcerpt, source: 'chat_reply' } : {})
        },
        tools: HOME_LEARNING_TOOLS,
        executeTool: (name, args, context) => this.executeHomeTool(name, args, context, epoch, requestText, requestVersion)
      });
      if (!isCurrentRequest()) return;
      this.removeThinking();
      await this.publishHomeAgentReply(reply, requestText);
      if (selectedExcerpt) this.clearChatFollowUp(selectedExcerpt);
    } catch (error) {
      if (!isCurrentRequest()) return;
      this.removeThinking();
      const reason = redactAgentSecrets(String(error?.message || '')).slice(0, 240);
      this.appendConversation({
        role: 'assistant',
        kind: 'error',
        content: reason ? `详细解析暂时失败：${reason}` : '详细解析暂时失败，请稍后重试。'
      });
    }
  },

  async requestGuidedLearning({ requestText, sourceMessageId, epoch, requestVersion, modelOverride, selectedExcerpt = '' }) {
    const isCurrentRequest = () => this.isHomeRequestActive(epoch, requestVersion);
    const sessionId = nextGuidedLearningId('guided-session');
    const controller = new AbortController();
    this._guidedRequestController = controller;
    this.showThinking('正在准备第一个学习步骤…');
    try {
      const instruction = guidedLearningSystemInstruction({
        level: Config.get('exam_level'),
        difficulty: Config.get('reading_mode')
      });
      const reply = await chatService.ask({
        sessionKey: 'home',
        session: conversationStore.getContextSession('home'),
        userMessage: requestText,
        modelOverride,
        kind: 'home',
        pageContext: {
          homeLearningMode: 'guided',
          guidedInstruction: instruction,
          sourceMessageId,
          ...(selectedExcerpt ? { selectedExcerpt, source: 'chat_reply' } : {})
        },
        tools: [CREATE_GUIDED_LEARNING_TOOL],
        webResearchEnabled: false,
        executeTool: async (name, args) => {
          if (name !== 'create_guided_learning') throw new Error('unsupported_guided_tool');
          const artifact = createGuidedLearningArtifact(args, { sessionId, sourceMessageId });
          return { result: { status: 'created', sessionId }, artifact };
        }
      });
      if (!isCurrentRequest()) return;
      let artifact = (reply.artifacts || []).find(item => item.type === 'guided_learning') || null;
      if (!artifact) {
        const parsed = parseGuidedLearningJson(reply.content);
        if (parsed) {
          try { artifact = createGuidedLearningArtifact(parsed, { sessionId, sourceMessageId }); } catch {}
        }
      }
      if (!artifact) {
        artifact = await this.repairGuidedLearningJson({
          phase: 'create', requestText, sourceMessageId, modelOverride, signal: controller.signal,
          target: { sessionId }, previousOutput: reply.content
        });
      }
      if (!isCurrentRequest()) return;
      this.removeThinking();
      if (artifact?.type === 'guided_learning') {
        this.addGuidedLearning(artifact.session);
      } else {
        this.addGuidedLearningFailure(
          { message: '互动教学没有生成有效步骤，请重试或改用详细解析。', reason: 'invalid_response' },
          { phase: 'create', sourceMessageId }
        );
      }
    } catch (error) {
      if (!isCurrentRequest()) return;
      this.removeThinking();
      if (!/AbortError|请求已取消/i.test(String(error?.message || ''))) {
        this.addGuidedLearningFailure(
          { message: '互动教学暂时无法生成，请重试或改用详细解析。', reason: 'request_failed' },
          { phase: 'create', sourceMessageId }
        );
      }
    } finally {
      if (this._guidedRequestController === controller) this._guidedRequestController = null;
    }
  },

  async requestGuidedAnswer({ requestText, target, session, epoch, requestVersion, modelOverride }) {
    const isCurrentRequest = () => this.isHomeRequestActive(epoch, requestVersion);
    const controller = new AbortController();
    this._guidedRequestController = controller;
    this.showThinking('正在根据你的回答调整下一步…');
    try {
      const reply = await chatService.ask({
        sessionKey: 'home',
        session: conversationStore.getContextSession('home'),
        userMessage: requestText,
        modelOverride,
        kind: 'home',
        pageContext: {
          homeLearningMode: 'guided_reply',
          guidedInstruction: '必须调用 adapt_guided_learning，只评价当前步骤与学习者这一次回答；不要提前展示后续步骤。',
          guidedSession: session
        },
        tools: [ADAPT_GUIDED_LEARNING_TOOL],
        webResearchEnabled: false,
        executeTool: async (name, args) => {
          if (name !== 'adapt_guided_learning') throw new Error('unsupported_guided_tool');
          const artifact = createGuidedLearningUpdateArtifact(args, {
            sessionId: target.sessionId,
            expectedRevision: target.expectedRevision,
            stepId: target.stepId
          });
          return { result: { status: 'evaluated', sessionId: target.sessionId }, artifact };
        }
      });
      if (!isCurrentRequest()) return;
      let update = (reply.artifacts || []).find(item => item.type === 'guided_learning_update') || null;
      if (!update) {
        const parsed = parseGuidedLearningJson(reply.content);
        if (parsed) {
          try {
            update = createGuidedLearningUpdateArtifact(parsed, {
              sessionId: target.sessionId,
              expectedRevision: target.expectedRevision,
              stepId: target.stepId
            });
          } catch {}
        }
      }
      if (!update) {
        update = await this.repairGuidedLearningJson({
          phase: 'adapt', requestText, session, target, modelOverride, signal: controller.signal,
          previousOutput: reply.content
        });
      }
      if (!isCurrentRequest()) return;
      this.removeThinking();
      const currentMessage = this.findGuidedMessageBySessionId(target.sessionId);
      const currentSession = normalizeGuidedLearningSession(currentMessage?.session);
      if (!currentMessage || !currentSession || currentSession.revision !== target.expectedRevision) return;
      if (!update
        || update.expectedRevision !== target.expectedRevision
        || update.stepId !== target.stepId) {
        this.addGuidedLearningFailure(
          { message: '这次回答没有成功评估，可以重试或改用详细解析。', reason: 'stale_or_invalid_update' },
          {
            phase: 'adapt', sourceMessageId: session.sourceMessageId, sessionId: target.sessionId,
            expectedRevision: target.expectedRevision, stepId: target.stepId, answer: requestText
          }
        );
        return;
      }
      const accepted = update.nextAction === 'advance' && update.outcome !== 'incorrect';
      let next = recordGuidedFreeResponse(currentSession, {
        stepId: target.stepId,
        value: requestText,
        outcome: accepted ? 'correct' : update.outcome,
        feedback: update.feedback,
        revisedContent: update.revisedContent,
        revisedHint: update.revisedHint
      });
      if (accepted) next = advanceGuidedLearning(next);
      this.replaceGuidedSession(this.homeMessageIdentity(currentMessage), next);
    } catch (error) {
      if (!isCurrentRequest()) return;
      this.removeThinking();
      if (!/AbortError|请求已取消/i.test(String(error?.message || ''))) {
        this.addGuidedLearningFailure(
          { message: '这次回答暂时无法评估，可以重试或改用详细解析。', reason: 'request_failed' },
          {
            phase: 'adapt', sourceMessageId: session.sourceMessageId, sessionId: target.sessionId,
            expectedRevision: target.expectedRevision, stepId: target.stepId, answer: requestText
          }
        );
      }
    } finally {
      if (this._guidedRequestController === controller) this._guidedRequestController = null;
    }
  },

  clearDraftPreviewUrls() {
    for (const [key, url] of this._imageDraftObjectUrls.entries()) {
      if (String(key).startsWith('history:')) continue;
      try { globalThis.URL?.revokeObjectURL(url); } catch {}
      this._imageDraftObjectUrls.delete(key);
    }
  },

  async submitComposer({ explicitText = null, consumeComposer = true } = {}) {
    const input = document.getElementById('promptInput');
    const value = explicitText == null ? input?.value.trim() || '' : String(explicitText).trim();
    const draftGroupId = consumeComposer ? this.imageDraftGroupId : null;
    if (!value && !draftGroupId) return;
    if (!Config.hasApiKey()) {
      Modal.showApiSettings();
      return;
    }

    const activeImageGroupId = consumeComposer ? this.activeImageGroupId : null;
    const imageReference = activeImageGroupId
      ? chatImagePolicy.inferImageReference(value)
      : { kind: 'none' };
    const useActiveImage = Boolean(activeImageGroupId && imageReference.kind === 'current');
    const hasImages = Boolean(draftGroupId || useActiveImage);
    const guidedReplyTarget = consumeComposer && !hasImages ? this.resolveGuidedReplyTarget() : null;
    const learningPreference = normalizeHomeLearningResponseMode(Config.get('home_learning_response_mode'));
    const learningRequest = hasImages || guidedReplyTarget
      ? { route: 'normal', reason: hasImages ? 'image_request' : 'guided_reply' }
      : classifyHomeLearningRequest(value, learningPreference);
    const requestModel = resolveModelForRequest({
      baseUrl: Config.get('base_url'),
      selectedModel: Config.get('model'),
      hasImages
    });
    if (requestModel.error === 'custom_model_image_capability_unknown') {
      this.appendConversation({
        role: 'assistant',
        kind: 'error',
        content: '当前模型或服务地址未声明图片能力。请在设置中选择官方 DeepSeek 地址与视觉模型后重试。'
      });
      return;
    }

    const selectedExcerpt = consumeComposer ? normalizeSelectedExcerpt(this._chatFollowUpExcerpt) : '';
    const epoch = this.homeEpoch;
    const requestVersion = this.beginHomeRequest();
    const isCurrentRequest = () => this.isHomeRequestActive(epoch, requestVersion);
    const imageRequestController = hasImages ? new AbortController() : null;
    this._imageRequestController = imageRequestController;
    let attachmentGroup = null;
    let imageGroup = null;
    let userMessageId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const requestSpan = diagnosticLogger()?.beginSpan('chat.request', {
      category: 'ai',
      correlationId: `chat-request:${userMessageId}`,
      detail: { scope: learningRequest.route, model: requestModel.model },
      payload: { route: learningRequest.route, hasImages, model: requestModel.model }
    });
    diagnosticLogger()?.record('chat.request_start', {
      category: 'ai',
      correlationId: requestSpan?.correlationId,
      detail: { scope: learningRequest.route, model: requestModel.model },
      payload: { route: learningRequest.route, hasImages, model: requestModel.model }
    });
    try {
      if (draftGroupId) {
        attachmentGroup = await this.getImageService().prepareForSend(draftGroupId, {
          signal: imageRequestController.signal
        });
        if (!isCurrentRequest()) return;
        if (!attachmentGroup?.attachments?.length) throw new Error('image_payload_unavailable');
        imageGroup = {
          groupId: attachmentGroup.groupId,
          attachmentIds: attachmentGroup.attachments.map(row => row.id),
          count: attachmentGroup.attachments.length,
          state: 'ready',
          visualSummary: ''
        };
      } else if (useActiveImage) {
        attachmentGroup = await this.getImageService().resolveContext({
          groupId: activeImageGroupId,
          mode: 'image',
          userMessage: value,
          signal: imageRequestController.signal
        });
        if (!isCurrentRequest()) return;
        if (attachmentGroup?.attachments?.length) {
          imageGroup = {
            groupId: attachmentGroup.groupId,
            attachmentIds: attachmentGroup.attachments.map(row => row.id),
            count: attachmentGroup.attachments.length,
            state: 'ready',
            visualSummary: attachmentGroup.visualSummary || ''
          };
        }
      }
      const requestText = value || DEFAULT_IMAGE_LEARNING_PROMPT;
      if (consumeComposer && !guidedReplyTarget) {
        this.skipPendingLearningChoices();
        this.pauseActiveGuidedSessions();
      }
      this.appendConversation({
        id: userMessageId,
        role: 'user',
        kind: 'text',
        content: requestText,
        ...(selectedExcerpt ? { selectedExcerpt } : {}),
        ...(imageGroup ? { imageGroup } : {})
      });
      if (consumeComposer && input) input.value = '';
      if (guidedReplyTarget) {
        this.clearGuidedLearningReply();
        await this.requestGuidedAnswer({
          requestText,
          target: guidedReplyTarget,
          session: guidedReplyTarget.session,
          epoch,
          requestVersion,
          modelOverride: requestModel.model
        });
        return;
      }
      if (!hasImages && learningRequest.route === 'choose') {
        if (selectedExcerpt) this.clearChatFollowUp(selectedExcerpt);
        this.addLearningModeChoice(userMessageId);
        return;
      }
      if (!hasImages && learningRequest.route === 'guided') {
        if (selectedExcerpt) this.clearChatFollowUp(selectedExcerpt);
        await this.requestGuidedLearning({
          requestText,
          sourceMessageId: userMessageId,
          epoch,
          requestVersion,
          modelOverride: requestModel.model,
          selectedExcerpt
        });
        return;
      }
      if (!hasImages && learningRequest.route === 'detailed') {
        await this.requestDetailedLearning({
          requestText,
          sourceMessageId: userMessageId,
          epoch,
          requestVersion,
          modelOverride: requestModel.model,
          selectedExcerpt
        });
        return;
      }
      this.showThinking(imageGroup ? '正在查看图片并整理学习重点…' : undefined);
      const session = conversationStore.getContextSession('home');
      const reply = await chatService.ask({
        sessionKey: 'home',
        session,
        userMessage: requestText,
        attachmentGroup,
        modelOverride: requestModel.model,
        kind: 'home',
        pageContext: selectedExcerpt ? { selectedExcerpt, source: 'chat_reply' } : null,
        tools: HOME_LEARNING_TOOLS,
        executeTool: (name, args, context) => this.executeHomeTool(name, args, context, epoch, requestText, requestVersion)
      });
      if (!isCurrentRequest()) return;
      this.removeThinking();
      this.removeArticleGenerationStatus();
      if (!attachmentGroup && reply.toolSupport === 'unsupported' && classifyComposerIntent(requestText) === 'generate') {
        if (selectedExcerpt) this.clearChatFollowUp(selectedExcerpt);
        return this.handleGenerate({ prompt: requestText, alreadyAdded: true, requestVersion });
      }
      await this.publishHomeAgentReply(reply, requestText);
      if (selectedExcerpt) this.clearChatFollowUp(selectedExcerpt);
      if (draftGroupId) {
        const summary = String(reply.content || '').slice(0, 1600);
        await this.getImageService().markSent(draftGroupId, {
          messageId: userMessageId,
          visualSummary: summary
        });
        conversationStore.replaceMessage('home', message => message.id === userMessageId, message => ({
          ...message,
          imageGroup: { ...message.imageGroup, state: 'sent', visualSummary: summary }
        }));
        await this.activateImageGroup(draftGroupId, { focus: false });
        this.imageDraftGroupId = null;
        this.imageDraftState = 'idle';
        this.clearDraftPreviewUrls();
        const strip = document.getElementById('chatImageDraftStrip');
        if (strip) {
          strip.hidden = true;
          strip.replaceChildren();
        }
        this.updateImageSendState();
      }

    } catch (error) {
      if (!isCurrentRequest()) return;
      requestSpan?.end({ level: 'error', payload: { name: error?.name || 'Error' } });
      diagnosticLogger()?.record('chat.request_failed', {
        category: 'ai',
        level: 'error',
        correlationId: requestSpan?.correlationId,
        payload: { route: learningRequest.route, hasImages, name: error?.name || 'Error' }
      });
      this.removeThinking();
      this.removeArticleGenerationStatus();
      const rawMessage = String(error?.message || '').trim();
      if (/请求已取消|AbortError/i.test(rawMessage)) {
        this.appendConversation({ role: 'assistant', kind: 'error', content: '请求已取消。' });
        return;
      }
      console.error('[home-agent] request failed', error);
      const reason = redactAgentSecrets(rawMessage).slice(0, 240);
      this.appendConversation({
        role: 'assistant',
        kind: 'error',
        content: imageGroup
          ? (reason ? `图片暂时无法分析：${reason}。图片仍保留在输入区，可重试。` : '图片暂时无法分析，图片仍保留在输入区，可重试。')
          : (reason ? `暂时无法回答：${reason}` : '暂时无法回答，请稍后重试。')
      });
      if (draftGroupId) {
        await this.renderImageDraft(draftGroupId);
        this.imageDraftState = 'error';
        this.updateImageSendState();
      }
    } finally {
      requestSpan?.end({ payload: { route: learningRequest.route, hasImages } });
      diagnosticLogger()?.record('chat.request_finished', {
        category: 'ai',
        correlationId: requestSpan?.correlationId,
        payload: { route: learningRequest.route, hasImages }
      });
      if (this._imageRequestController === imageRequestController) {
        this._imageRequestController = null;
      }
    }
  },

  async handleDailyReport() {
    if (this._dailyReportRequestPending) return;
    this._dailyReportRequestPending = true;
    try {
      return await this.submitComposer({
        explicitText: '给我今日日报',
        consumeComposer: false
      });
    } finally {
      this._dailyReportRequestPending = false;
    }
  },

  async executeHomeTool(name, args = {}, { signal } = {}, epoch, userRequest = '', requestVersion) {
    if (name === 'get_app_capabilities') {
      return {
        result: {
          source: 'app_capabilities',
          version: 1,
          capabilities: AppCapabilityRegistry.search({ query: args.query, ids: args.ids }).slice(0, 8)
        }
      };
    }
    if (name === 'offer_app_actions') {
      const artifact = createCapabilityActionArtifact(args.actions || []);
      return {
        result: { status: artifact.actions.length ? 'offered' : 'no_valid_actions', capabilityIds: artifact.actions.map(item => item.capabilityId) },
        ...(artifact.actions.length ? { artifact } : {})
      };
    }
    if (name === 'get_recent_learning_activity') {
      return {
        result: {
          source: 'recent_learning_activity',
          activities: conversationStore.getRecentActivities('home', args.limit || 50)
        }
      };
    }
    if (name === 'search_web') {
      const searchCalls = (this._searchCallCounts.get(requestVersion) || 0) + 1;
      this._searchCallCounts.set(requestVersion, searchCalls);
      if (this._searchCallCounts.size > 20) {
        const firstKey = this._searchCallCounts.keys().next().value;
        this._searchCallCounts.delete(firstKey);
      }
      if (searchCalls > 2) {
        return { result: { source: 'web_research', status: 'search_limit', query, searchedAt: Date.now(), sources: [] } };
      }
      const query = String(args.query || '').trim();
      const startedAt = Date.now();
      const result = await webResearch.search({
        query,
        recencyDays: args.recencyDays,
        domains: args.domains,
        signal
      });
      const artifact = {
        type: 'research_sources',
        status: result.status,
        query,
        recencyDays: Number(result.recencyDays) || 0,
        searchedAt: result.searchedAt || Date.now(),
        reason: result.reason || '',
        sources: result.sources || []
      };
      if (result.status === 'ok' || result.status === 'no_results') {
        this.recordHomeActivity({
          type: 'web_research',
          status: result.status === 'ok' ? 'success' : 'no_results',
          startedAt,
          query,
          resultCount: (result.sources || []).length,
          domains: [...new Set((result.sources || []).map(source => source.domain).filter(Boolean))].slice(0, 5)
        });
      } else if (result.status === 'error') {
        this.recordHomeActivity({
          type: 'web_research',
          status: 'failed',
          startedAt,
          query,
          failureReason: result.reason || 'network'
        });
      }
      return {
        result: {
          source: 'web_research',
          status: result.status,
          query,
          searchedAt: artifact.searchedAt,
          sources: result.sources || []
        },
        artifact
      };
    }
    if (name === 'get_daily_learning_report') {
      const report = await learningAgent.execute(name, args);
      const artifact = dailyReportArtifactOf(report);
      if (!artifact) return { result: report };
      return {
        result: toDailyReportHistoryToolResult(report),
        artifact
      };
    }
    if (name === 'get_today_learning_report') {
      const report = await learningAgent.execute(name, args);
      const artifact = dailyReportArtifactOf(report);
      return {
        result: toDailyReportToolResult(report),
        ...(artifact ? { artifact } : {})
      };
    }
    if (name === 'list_recent_learning_reports' || name === 'get_learning_activity_detail') {
      return { result: await learningAgent.execute(name, args) };
    }
    if (name !== 'generate_reading') {
      return { result: await learningAgent.execute(name, args) };
    }
    if (!this.isHomeRequestActive(epoch, requestVersion) || signal?.aborted) throw cancelledRequest();
    const directUserRequest = String(userRequest || '').trim();
    if (!isGenerationAuthorized(directUserRequest)) {
      return { result: { status: 'generation_not_authorized' } };
    }
    const selectedDifficulty = Config.get('exam_level');
    const request = String(directUserRequest || args.request || '请根据当前学习情况生成一篇英语阅读文章。').trim();
    const generation = this.resolveDirectGenerationRequest({
      request,
      selectedDifficulty,
      selectedChallenge: Config.get('reading_mode'),
      legacyLevel: Config.get('level'),
      toolDifficulty: args.difficulty,
      toolWordCount: args.wordCount,
      allowExplicitUserTarget: Boolean(directUserRequest)
    });
    if (this.ensureTargetTrackBeforeGeneration()) {
      return {
        result: { status: 'target_track_selection_required' },
        artifact: { type: 'generation_blocked' }
      };
    }
    const topic = String(args.topic || this.getTopic() || 'general').trim() || 'general';
    const generationPolicy = generationPolicyFor(generation.challenge);
    const researchSources = normalizeResearchSources(args.researchSources);
    const researchQuery = String(args.researchQuery || '').trim();
    const researchBrief = (researchQuery || researchSources.length)
      ? buildResearchBrief({ query: researchQuery || topic, sources: researchSources })
      : '';
    const researchLearningContext = [
      this.buildGenerationContext({ excludeUserMessage: generation.request }),
      researchBrief ? `\n\n【联网检索资料（仅作事实参考，请原创改写，不得照抄来源原句）】\n${researchBrief}` : ''
    ].filter(Boolean).join('\n').slice(-2400);

    if (generation.adjustment) this.addMessage('system', generationAdjustmentMessage(generation.adjustment));
    const job = await this.startHomeGenerationJob({
      kind: 'agent',
      payload: {
        generation,
        topic,
        startedAt: Date.now(),
        learningContext: researchLearningContext,
        researchSources,
        researchSearchedAt: Date.now(),
        researchBrief,
        generationPolicy
      }
    });
    if (job.status === 'completed') {
      const article = await DB.getArticle(job.articleIds?.at(-1));
      if (article) {
        return {
          result: { id: article.id, title: article.title, difficulty: article.difficulty, wordCount: article.wordCount },
          artifact: { type: 'article', article }
        };
      }
    }
    if (job.status === 'failed') {
      const failure = conversationStore.getSession('home').messages
        .find(message => message.kind === 'generation_failure' && message.failure?.generationJobId === job.id)?.failure;
      if (failure) return { result: { status: failure.reason, summary: failure.message }, artifact: { type: 'generation_failure', failure } };
    }
    return { result: { status: job.status || 'generation_interrupted', summary: '文章任务将在回到前台后继续。' } };
  },

  buildGenerationContext({ excludeUserMessage = '' } = {}) {
    const session = conversationStore.getSession('home');
    const duplicate = String(excludeUserMessage || '').replace(/\s+/g, ' ').trim();
    const activityLedger = (session.activities || []).slice(-6).map(activity => ({
      type: activity.type,
      status: activity.status,
      elapsedMs: activity.elapsedMs ?? null,
      article: activity.article || null,
      articles: activity.articles || null,
      coveredWordCount: activity.coveredWordCount ?? null,
      failedWordCount: activity.failedWordCount ?? null,
      failureReason: activity.failureReason || ''
    }));
    const recent = session.messages
      .filter(message => message.kind === 'text' || message.kind === 'article' || message.kind === 'generation_failure')
      .slice(-8)
      .map(message => {
        if (message.kind === 'article') {
          const article = message.article || {};
          return `已生成阅读：${article.title || '未命名文章'}${article.titleZh ? `（${article.titleZh}）` : ''}；${article.difficulty || '未标注难度'}；${article.topic || '综合'}；${article.wordCount || '未知'} 词。`;
        }
        if (message.kind === 'generation_failure') {
          const failure = message.failure || {};
          const generation = failure.generation || {};
          return `生成未完成：${failure.message || '内容不完整'}（${generation.difficulty || '未标注难度'} / ${generation.wordCount || '未知'} 词）。`;
        }
        const content = String(message.content || '').replace(/\s+/g, ' ').trim();
        if (message.role === 'user' && duplicate && content === duplicate) return '';
        return `${message.role === 'user' ? '学习者' : '助手'}：${content}`;
      })
      .filter(Boolean)
      .join('\n');
    return [
      session.summary,
      activityLedger.length ? `真实活动账本：${JSON.stringify(activityLedger)}` : '',
      recent
    ].filter(Boolean).join('\n').slice(-1600);
  },

  // Get selected topic
  getTopic() {
    return 'general';
  },

  // Handle article generation
  async handleGenerate({ prompt: providedPrompt, alreadyAdded = false, providedGeneration = null, topicOverride = '', suppressAdjustmentNotice = false, requestVersion = null, retryFailureId = '', researchSources = null, researchQuery = '', researchSearchedAt = 0 } = {}) {
    if (!Config.hasApiKey()) {
      Modal.showApiSettings();
      return;
    }

    const generateButton = document.getElementById('generateBtn');
    if (generateButton?.disabled) return;

    const prompt = providedPrompt ?? providedGeneration?.request ?? document.getElementById('promptInput').value.trim();
    const directUserRequest = String(prompt || '').trim();
    const selectedDifficulty = Config.get('exam_level');
    const effectivePrompt = prompt || `请随机选择一个有趣的话题，生成一篇${DIFFICULTY_LABELS[selectedDifficulty]}难度的英语阅读文章。`;
    const generation = providedGeneration || this.resolveDirectGenerationRequest({
      request: effectivePrompt,
      selectedDifficulty,
      selectedChallenge: Config.get('reading_mode'),
      legacyLevel: Config.get('level'),
      allowExplicitUserTarget: Boolean(directUserRequest)
    });
    if (this.ensureTargetTrackBeforeGeneration()) return;
    if (requestVersion == null) this.beginHomeRequest({ cancelGeneration: true });
    this.commitGenerationTargetSelection(generation);
    const difficulty = generation.difficulty;
    const topic = topicOverride || this.getTopic();
    const safeResearchSources = normalizeResearchSources(researchSources || null);
    const researchQueryText = String(researchQuery || '').trim();
    const researchBrief = (researchQueryText || safeResearchSources.length)
      ? buildResearchBrief({ query: researchQueryText || topic, sources: safeResearchSources })
      : '';
    const researchLearningContext = [
      this.buildGenerationContext({ excludeUserMessage: generation.request }),
      researchBrief ? `\n\n【联网检索资料（仅作事实参考，请原创改写，不得照抄来源原句）】\n${researchBrief}` : ''
    ].filter(Boolean).join('\n').slice(-2400);
    const generationPolicy = generationPolicyFor(generation.challenge);

    if (!alreadyAdded) {
      this.addMessage('user', prompt
        ? prompt
        : `请随机生成一篇${DIFFICULTY_LABELS[difficulty]}难度的英语阅读文章。`);
    }
    if (generation.adjustment && !suppressAdjustmentNotice) {
      this.addMessage('system', generationAdjustmentMessage(generation.adjustment));
    }

    if (generateButton) {
      generateButton.disabled = true;
      generateButton.textContent = '…';
      generateButton.setAttribute('aria-label', '正在生成阅读');
    }

    // Clear input immediately
    const promptInput = document.getElementById('promptInput');
    if (promptInput) promptInput.value = '';
    const startedAt = Date.now();
    try {
      return await this.startHomeGenerationJob({
        kind: 'direct',
        payload: {
          generation,
          topic,
          startedAt,
          retryFailureId,
          learningContext: researchLearningContext,
          researchSources: safeResearchSources,
          researchSearchedAt: Number(researchSearchedAt) || 0,
          researchBrief,
          generationPolicy
        }
      });
    } finally {
      this.resetGenerateButton();
      this.removeArticleGenerationStatus();
      if (retryFailureId) this.setGenerationFailureRetryState(retryFailureId, false);
    }
  },

  publishReviewArticles(articles, generationSession) {
    if (!generationSession.isActive()) return false;
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      articles.forEach(article => this.addArticleCard(article));
    } else {
      articles.forEach(article => PendingArticles.add(article, article.usedWords));
    }
    return true;
  },

  async discardReviewArticles(articles = []) {
    const ids = [...new Set(articles.map(article => article?.id).filter(Boolean))];
    await Promise.all(ids.map(id => DB.deleteArticle(id).catch(() => {})));
  },

  addReviewContinueAction(count, onContinue) {
    const container = document.getElementById('chatMessages');
    if (!container || count <= 0) return;
    const div = document.createElement('div');
    div.className = 'message system-message review-continue-message';
    div.innerHTML = `<div class="due-reminder"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> 还有 <strong>${count}</strong> 个词待覆盖 <button class="btn btn-outline btn-sm review-continue-btn" type="button">继续生成剩余</button></div>`;
    const button = div.querySelector('.review-continue-btn');
    button?.addEventListener('click', () => {
      if (button.disabled) return;
      button.disabled = true;
      void Promise.resolve(onContinue?.()).finally(() => { button.disabled = false; });
    });
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  async generateReviewReadings({ reviewWords = [], difficulty, topic = '复习巩固', sourceLabel = '待复习词' } = {}) {
    if (this.ensureTargetTrackBeforeGeneration()) return;
    if (this.isReviewGenerating || !Config.hasApiKey()) {
      if (!Config.hasApiKey()) Modal.showApiSettings();
      return;
    }

    const normalizedWords = normalizeTargetWords(reviewWords, Number.POSITIVE_INFINITY);
    if (!normalizedWords.length) {
      this.addMessage('system', '没有待复习的单词。先导入单词或在阅读中收藏单词。');
      return;
    }

    const epoch = this.homeEpoch;
    const requestVersion = this.beginHomeRequest({ cancelGeneration: true });
    const allArticles = await DB.getAllArticles();
    if (!this.isHomeRequestActive(epoch, requestVersion)) return;

    const plan = planReviewBatches({
      words: normalizedWords,
      articles: allArticles,
      maxArticles: 4
    });
    const selectedBatches = plan.batches;
    const selectedWords = plan.selectedWords;
    const effectiveDifficulty = difficulty || Config.get('exam_level') || 'cet4';
    if (!selectedBatches.length) {
      this.addMessage('system', `今天的${sourceLabel}已生成巩固阅读，稍后可直接开始阅读。`);
      return;
    }

    const startedAt = Date.now();
    const deferredCount = plan.remainingWords.length;
    this.addMessage('user', `🔄 复习阅读 | 难度：${DIFFICULTY_LABELS[effectiveDifficulty]}\n${sourceLabel} ${normalizedWords.length} 个词\n本次优先覆盖 ${selectedWords.length} 个词${deferredCount > 0 ? `，剩余 ${deferredCount} 个词可继续生成。` : '。'}`);
    return this.startHomeGenerationJob({
      kind: 'review',
      payload: {
        batches: selectedBatches,
        normalizedWords,
        difficulty: effectiveDifficulty,
        topic,
        sourceLabel,
        deferredCount,
        startedAt,
        learningContext: this.buildGenerationContext(),
        generationPolicy: generationPolicyFor('support')
      },
      cancelExisting: false
    });
  },

  // Handle review reading generation from the home shortcut.
  async handleReviewGenerate() {
    if (this.ensureTargetTrackBeforeGeneration()) return;
    if (this.isReviewGenerating || !Config.hasApiKey()) {
      if (!Config.hasApiKey()) Modal.showApiSettings();
      return;
    }
    const allLearnWords = await DB.getAllLearnWords();
    const dueWords = SpacedRepetition.getDueWords(allLearnWords);
    const nonStableWords = allLearnWords.filter(w => !SpacedRepetition.isStable(w));
    const stableWords = allLearnWords.filter(w => SpacedRepetition.isStable(w));
    const reviewWords = normalizeTargetWords(
      [...dueWords, ...nonStableWords, ...stableWords].map(word => word.word),
      Number.POSITIVE_INFINITY
    );
    return this.generateReviewReadings({
      reviewWords,
      difficulty: Config.get('exam_level') || 'cet4',
      topic: this.getTopic(),
      sourceLabel: '待复习词'
    });
  },

  appendConversation(message) {
    const persisted = conversationStore.append('home', message);
    const maintenance = conversationStore.maintainHomeConversation();
    if (maintenance.trimmed) this.compactHomeConversationDOM(maintenance.retainedMessageIds);
    const messageId = this.homeMessageIdentity(persisted || message);
    if (message.kind === 'article') {
      this.addArticleCardToDOM(message.article, messageId);
    } else if (message.kind === 'generation_failure') {
      this.addGenerationFailureToDOM(message.failure, messageId);
    } else if (message.kind === 'app_actions') {
      this.addAppActionsToDOM(message.actions || [], messageId);
    } else if (message.kind === 'research_sources') {
      this.addResearchSourcesToDOM(message.research || message, messageId);
    } else if (message.kind === 'daily_report') {
      void this.restoreDailyReportReference({ ...message, id: messageId });
    } else if (message.kind === 'learning_mode_choice') {
      this.addLearningModeChoiceToDOM(message);
    } else if (message.kind === 'guided_learning') {
      this.addGuidedLearningToDOM(message.session, messageId);
    } else if (message.kind === 'guided_learning_failure') {
      this.addGuidedLearningFailureToDOM(message.failure, { ...message, id: messageId });
    } else {
      const type = message.kind === 'notice' ? 'system' : message.kind === 'error' ? 'error' : message.role;
      void this.addMessageToDOM(type, message.content, {
        imageGroup: message.imageGroup,
        messageId
      });
    }
    return persisted;
  },

  activityArticle(article = {}) {
    return {
      id: article.id,
      title: String(article.title || '').slice(0, 160),
      difficulty: String(article.difficulty || '').slice(0, 32),
      wordCount: Number(article.wordCount) || 0
    };
  },

  recordHomeActivity(activity = {}) {
    const completedAt = Date.now();
    const startedAt = Number.isFinite(Number(activity.startedAt)) ? Number(activity.startedAt) : completedAt;
    return conversationStore.appendActivity('home', {
      ...activity,
      startedAt,
      completedAt,
      elapsedMs: Math.max(0, completedAt - startedAt)
    });
  },

  recordNativeResearchActivity(research = {}) {
    if (!research || research.native !== true) return;
    const sources = Array.isArray(research.sources) ? research.sources : [];
    this.recordHomeActivity({
      type: 'web_research',
      status: research.status === 'ok' || research.status === 'searched' ? 'success' : research.status === 'no_results' ? 'no_results' : 'failed',
      startedAt: Date.now() - 800,
      query: String(research.query || '联网检索').slice(0, 160),
      resultCount: sources.length,
      domains: [...new Set(sources.map(source => source.domain).filter(Boolean))].slice(0, 5)
    });
  },

  showThinking(label = '正在理解你的请求…') {
    const container = document.getElementById('chatMessages');
    if (!container || document.getElementById('chatThinking')) return;
    const thinking = document.createElement('div');
    thinking.id = 'chatThinking';
    thinking.className = 'message ai-message chat-thinking';
    thinking.textContent = label;
    container.appendChild(thinking);
    container.scrollTop = container.scrollHeight;
  },

  removeThinking() {
    document.getElementById('chatThinking')?.remove();
  },

  showArticleGenerationStatus(label = '文章定制中…') {
    this.removeThinking();
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const existing = document.getElementById('articleGenerationStatus');
    if (existing) {
      const labelNode = existing.querySelector('span');
      if (labelNode) labelNode.textContent = label;
      return;
    }
    const status = document.createElement('div');
    status.id = 'articleGenerationStatus';
    status.className = 'message ai-message chat-thinking article-generation-status';
    status.innerHTML = `<i class="fa-solid fa-pen-ruler" aria-hidden="true"></i><span>${esc(label)}</span>`;
    container.appendChild(status);
    container.scrollTop = container.scrollHeight;
  },

  removeArticleGenerationStatus() {
    document.getElementById('articleGenerationStatus')?.remove();
  },

  syncHomeGenerationPreview(preview) {
    const container = document.getElementById('chatMessages');
    if (!container || !preview?.jobId) return;
    const key = `${preview.jobId}-${Number(preview.batchIndex) || 0}`;
    let node = [...container.querySelectorAll('[data-generation-preview]')]
      .find(candidate => candidate.dataset.generationPreview === key);
    if (!node) {
      node = document.createElement('div');
      node.className = 'message ai-message generation-preview-message';
      node.dataset.generationPreview = key;
      container.appendChild(node);
    }
    const title = preview.title || '文章制作中…';
    const body = preview.content || '正在等待英文正文…';
    const wordCount = Number(preview.wordCount) || 0;
    node.innerHTML = `
      <section class="article-card generation-draft-card" aria-label="文章制作中">
        <div class="article-card-header">
          <span class="article-title">${esc(title)}</span>
          <span class="badge badge-generating">制作中</span>
          ${wordCount ? `<span class="word-count">${wordCount} 词</span>` : ''}
        </div>
        ${preview.titleZh ? `<div class="article-title-zh">${esc(preview.titleZh)}</div>` : ''}
        <div class="article-preview">${esc(body)}</div>
        <button class="btn btn-outline btn-sm" type="button" disabled>文章完成后可阅读全文</button>
      </section>`;
    container.scrollTop = container.scrollHeight;
  },

  queueHomeGenerationPreview(preview) {
    if (!preview?.jobId) return;
    const key = `${preview.jobId}-${Number(preview.batchIndex) || 0}`;
    this._generationPreviewQueue.set(key, preview);
    if (this._generationPreviewTimer) return;
    this._generationPreviewTimer = setTimeout(() => {
      this._generationPreviewTimer = null;
      const pending = [...this._generationPreviewQueue.values()];
      this._generationPreviewQueue.clear();
      pending.forEach(item => this.syncHomeGenerationPreview(item));
    }, 70);
  },

  removeHomeGenerationPreviews(jobId) {
    const prefix = `${String(jobId)}-`;
    document.querySelectorAll('[data-generation-preview]').forEach(node => {
      if (node.dataset.generationPreview?.startsWith(prefix)) node.remove();
    });
  },

  // Compatibility entry point used by reading and review flows.
  addMessage(type, text) {
    if (type === 'article') return this.addArticleCard(text);
    this.appendConversation({
      role: type === 'user' ? 'user' : 'assistant',
      kind: type === 'error' ? 'error' : type === 'system' ? 'notice' : 'text',
      content: String(text || '')
    });
  },

  // Add article card to the home session and preload its vocabulary audio.
  addArticleCard(article) {
    this.appendConversation({ role: 'assistant', kind: 'article', article });
    if (article.content) {
      AudioCache.preloadWords(article.content).catch(() => {});
    }
  },

  addAppActions(actions = []) {
    this.appendConversation({ role: 'assistant', kind: 'app_actions', actions });
  },

  addAppActionsToDOM(actions = [], messageId = '') {
    if (!actions.length) return;
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'message ai-message app-action-message';
    if (messageId) div.dataset.homeMessageId = String(messageId);
    div.innerHTML = `<nav class="app-action-card" aria-label="建议的学习操作">
      ${actions.slice(0, 3).map(action => `<a class="app-action-link" href="${esc(action.route)}"><span>${esc(action.label)}</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>`).join('')}
    </nav>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  addResearchSources(research = {}) {
    this.appendConversation({ role: 'assistant', kind: 'research_sources', research });
  },

  addResearchSourcesToDOM(research = {}, messageId = '') {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'message ai-message research-sources-message';
    if (messageId) div.dataset.homeMessageId = String(messageId);
    if (research.status === 'missing_key') {
      div.innerHTML = `<section class="research-sources-card" aria-label="联网检索">
        <div class="research-sources-head"><i class="fa-solid fa-globe" aria-hidden="true"></i><strong>联网检索</strong><span>需要 Tavily Key</span></div>
        <p class="research-sources-empty">配置联网检索 Key 后，首页 Agent 才能查询最新资讯并保留真实来源。关闭后不影响现有学习功能。</p>
        <div class="research-sources-actions"><a class="btn btn-outline btn-sm" href="#/settings">去设置</a><button class="btn btn-outline btn-sm research-sources-dismiss" type="button">暂不需要</button></div>
      </section>`;
    } else if (research.status === 'searched') {
      div.innerHTML = `<section class="research-sources-card" aria-label="联网检索">
        <div class="research-sources-head"><i class="fa-solid fa-globe" aria-hidden="true"></i><strong>联网检索</strong><span>${esc(research.query || '')}</span></div>
        <p class="research-sources-empty">已联网检索完成，真实来源已列在上方回答中。</p>
      </section>`;
    } else if (research.status === 'error' || research.status === 'no_results') {
      const message = research.status === 'no_results' ? '没有检索到可靠结果，未使用联网资料。' : '联网检索暂时失败，未使用联网资料。';
      div.innerHTML = `<section class="research-sources-card" aria-label="联网检索"><p class="research-sources-empty">${esc(message)}</p></section>`;
    } else {
      const sources = Array.isArray(research.sources) ? research.sources.slice(0, 5) : [];
      div.innerHTML = `<section class="research-sources-card" aria-label="联网检索">
        <div class="research-sources-head"><i class="fa-solid fa-globe" aria-hidden="true"></i><strong>联网检索</strong><span>${esc(research.query || '')}</span></div>
        <ul class="research-sources-list">
          ${sources.map(source => `<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title || source.domain)}</a><small>${esc(source.domain)}${source.publishedAt ? ` · ${esc(source.publishedAt)}` : ''}</small></li>`).join('')}
        </ul>
        ${sources.length ? '<button class="btn btn-primary btn-sm research-generate-btn" type="button">据此生成阅读</button>' : ''}
      </section>`;
      const generate = div.querySelector('.research-generate-btn');
      generate?.addEventListener('click', () => {
        if (generate.disabled) return;
        generate.disabled = true;
        void this.handleGenerate({
          researchSources: sources,
          researchQuery: research.query,
          researchSearchedAt: research.searchedAt
        }).finally(() => { generate.disabled = false; });
      });
    }
    const dismiss = div.querySelector('.research-sources-dismiss');
    dismiss?.addEventListener('click', () => div.remove());
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  findDailyReportElement(reportId) {
    const wanted = String(reportId || '');
    return [...document.querySelectorAll('[data-daily-report-message]')]
      .find(element => element.dataset.reportId === wanted) || null;
  },

  addExpiredDailyReportToDOM(reference = {}, messageId = '') {
    const container = document.getElementById('chatMessages');
    if (!container) return null;
    const reportId = String(reference.reportId || `daily:${reference.dateKey || ''}`);
    const existing = this.findDailyReportElement(reportId);
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'message ai-message daily-report-message daily-report-expired-message';
    if (messageId) div.dataset.homeMessageId = String(messageId);
    div.dataset.dailyReportMessage = 'true';
    div.dataset.reportId = reportId;
    div.innerHTML = `<section class="daily-report-card daily-report-expired-card" aria-label="日报已过期">
      <div class="daily-report-expired-copy"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i><div><strong>日报已过期</strong><p>${esc(reference.dateKey || '这一天')} 的日报已从本地保留期中移除。</p></div></div>
    </section>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  },

  addDailyReportToDOM(report, artifact = null, messageId = '') {
    const container = document.getElementById('chatMessages');
    if (!container || !report) return null;
    const resolvedArtifact = artifact || dailyReportArtifactOf(report);
    if (!resolvedArtifact) return null;
    const existing = this.findDailyReportElement(resolvedArtifact.reportId);
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'message ai-message daily-report-message';
    if (messageId) div.dataset.homeMessageId = String(messageId);
    div.dataset.dailyReportMessage = 'true';
    div.dataset.reportId = resolvedArtifact.reportId;
    div.dataset.reportFingerprint = resolvedArtifact.dataFingerprint || String(report.dataFingerprint || '');
    div.setAttribute('data-copyable', 'true');
    div.setAttribute('data-copy-value', String(report.markdown || ''));
    div.innerHTML = renderDailyReportCard(report);
    const markdown = div.querySelector('[data-daily-report-markdown="true"]');
    if (markdown && report.markdown) markdown.innerHTML = renderLearningMarkdown(report.markdown);
    const toggle = div.querySelector('.daily-report-toggle');
    const expanded = div.querySelector('[data-daily-report-expanded="true"]');
    toggle?.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.textContent = open ? '展开日报' : '收起日报';
      if (expanded) expanded.hidden = open;
    });
    div.appendChild(createCopyButton({ label: '复制日报' }));
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  },

  async restoreDailyReportReference(reference = {}) {
    const dateKey = String(reference.dateKey || '').trim();
    const reportId = String(reference.reportId || `daily:${dateKey}`);
    const messageId = this.homeMessageIdentity(reference);
    if (!dateKey || reportId !== `daily:${dateKey}`) return this.addExpiredDailyReportToDOM({ dateKey, reportId }, messageId);
    let report = null;
    try {
      report = await DB.getDailyLearningReport(dateKey);
    } catch {
      report = null;
    }
    if (!report || (Number(report.expiresAt) > 0 && Number(report.expiresAt) <= Date.now())) {
      return this.addExpiredDailyReportToDOM({ dateKey, reportId }, messageId);
    }
    return this.addDailyReportToDOM(report, null, messageId);
  },

  async publishDailyReportArtifact(artifact = {}) {
    const dateKey = String(artifact.dateKey || '').trim();
    const reportId = String(artifact.reportId || `daily:${dateKey}`);
    if (!dateKey || reportId !== `daily:${dateKey}`) return null;
    let report = null;
    try {
      report = await DB.getDailyLearningReport(dateKey);
    } catch {
      report = null;
    }
    if (!report || (Number(report.expiresAt) > 0 && Number(report.expiresAt) <= Date.now())) {
      const reference = { role: 'assistant', kind: 'daily_report', reportId, dateKey };
      if (!conversationStore.getSession('home').messages.some(message => message.kind === 'daily_report' && message.reportId === reportId)) {
        const persisted = conversationStore.append('home', reference);
        const maintenance = conversationStore.maintainHomeConversation();
        if (maintenance.trimmed) this.compactHomeConversationDOM(maintenance.retainedMessageIds);
        return this.addExpiredDailyReportToDOM(reference, this.homeMessageIdentity(persisted || reference));
      }
      return this.addExpiredDailyReportToDOM(reference, this.homeMessageIdentity(reference));
    }
    return this.publishDailyReport(report, artifact);
  },

  publishDailyReport(report, artifact = null) {
    const resolvedArtifact = artifact || dailyReportArtifactOf(report);
    if (!resolvedArtifact) return false;
    const session = conversationStore.getSession('home');
    const existingReference = session.messages.find(message => (
      message.kind === 'daily_report' && message.reportId === resolvedArtifact.reportId
    ));
    const existingElement = this.findDailyReportElement(resolvedArtifact.reportId);
    const existingFingerprint = existingElement?.dataset.reportFingerprint || '';
    if (existingReference && existingFingerprint === (resolvedArtifact.dataFingerprint || String(report.dataFingerprint || ''))) return false;
    let persistedReference = existingReference;
    if (!existingReference) {
      persistedReference = conversationStore.append('home', {
        role: 'assistant',
        kind: 'daily_report',
        reportId: resolvedArtifact.reportId,
        dateKey: resolvedArtifact.dateKey
      });
      const maintenance = conversationStore.maintainHomeConversation();
      if (maintenance.trimmed) this.compactHomeConversationDOM(maintenance.retainedMessageIds);
    }
    const messageId = this.homeMessageIdentity(persistedReference || resolvedArtifact);
    if (Number(report.expiresAt) > 0 && Number(report.expiresAt) <= Date.now()) {
      this.addExpiredDailyReportToDOM(resolvedArtifact, messageId);
    } else {
      this.addDailyReportToDOM(report, resolvedArtifact, messageId);
    }
    return true;
  },

  createGenerationFailure(error, generation, topic) {
    return makeGenerationFailure(error, generation, topic);
  },

  normalizeGenerationFailure(failure, userRequest) {
    const selectedDifficulty = Config.get('exam_level') || 'cet4';
    const fallbackGeneration = resolveGenerationRequest({
      request: String(userRequest || '请根据当前学习情况生成一篇英语阅读文章。').trim(),
      selectedDifficulty,
      selectedChallenge: Config.get('reading_mode'),
      legacyLevel: Config.get('level')
    });
    return hydrateGenerationFailure(failure, fallbackGeneration, this.getTopic());
  },

  addGenerationFailure(failure) {
    const failureId = nextGenerationFailureId();
    this.appendConversation({ id: failureId, role: 'assistant', kind: 'generation_failure', failure });
    return failureId;
  },

  findGenerationFailureElement(failureId) {
    return [...document.querySelectorAll('.generation-failure-message')]
      .find(element => element.dataset.failureId === String(failureId));
  },

  setGenerationFailureRetryState(failureId, retrying) {
    const element = this.findGenerationFailureElement(failureId);
    if (!element) return;
    element.dataset.retrying = retrying ? 'true' : 'false';
    element.querySelector('.generation-retry-btn')?.toggleAttribute('disabled', retrying);
  },

  renderGenerationFailureToDOM(div, failure, failureId) {
    const stableId = String(failureId || nextGenerationFailureId());
    const message = String(failure?.message || '文章未通过难度校验，请重新生成。').trim();
    const generation = failure?.generation;
    const canRetry = generation?.request && generation?.difficulty && generation?.challenge && Number(generation?.wordCount) > 0;
    div.dataset.failureId = stableId;
    div.dataset.retrying = 'false';
    div.innerHTML = `
      <section class="generation-failure-card" aria-label="文章生成失败">
        <div class="generation-failure-copy">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
          <div><strong>文章需要重新定制</strong><p>${esc(message)}</p></div>
        </div>
        ${canRetry ? '<button class="btn btn-outline btn-sm generation-retry-btn" type="button">重新生成</button>' : ''}
      </section>`;
    const retryButton = div.querySelector('.generation-retry-btn');
    if (retryButton) {
      retryButton.addEventListener('click', () => {
        if (div.dataset.retrying === 'true') return;
        this.setGenerationFailureRetryState(stableId, true);
        void this.handleGenerate({
          prompt: generation.request,
          alreadyAdded: true,
          providedGeneration: generation,
          topicOverride: failure?.topic,
          suppressAdjustmentNotice: true,
          retryFailureId: stableId
        }).catch(() => {}).finally(() => this.setGenerationFailureRetryState(stableId, false));
      });
    }
  },

  addGenerationFailureToDOM(failure, failureId = '') {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'message ai-message generation-failure-message';
    if (failureId) div.dataset.homeMessageId = String(failureId);
    this.renderGenerationFailureToDOM(div, failure, failureId);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  replaceGenerationFailure(failureId, failure) {
    const stableId = String(failureId);
    const replaced = conversationStore.replaceMessage('home', message => (
      message.kind === 'generation_failure'
      && (message.id === stableId || String(message.createdAt) === stableId)
    ), message => ({ ...message, id: stableId, failure }));
    const element = this.findGenerationFailureElement(stableId);
    if (!replaced) {
      conversationStore.append('home', { id: stableId, role: 'assistant', kind: 'generation_failure', failure });
      const maintenance = conversationStore.maintainHomeConversation();
      if (maintenance.trimmed) this.compactHomeConversationDOM(maintenance.retainedMessageIds);
    }
    if (element) this.renderGenerationFailureToDOM(element, failure, stableId);
    else this.addGenerationFailureToDOM(failure, stableId);
    return replaced;
  },

  removeGenerationFailure(failureId) {
    const stableId = String(failureId);
    conversationStore.removeMessages('home', message => (
      message.kind === 'generation_failure'
      && (message.id === stableId || String(message.createdAt) === stableId)
    ));
    this.findGenerationFailureElement(stableId)?.remove();
  },

  // Add message to DOM only (no history save)
  async addMessageToDOM(type, text, { imageGroup = null, messageId = '' } = {}) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `message ${type}-message`;
    if (messageId) {
      div.dataset.homeMessageId = String(messageId);
      div.dataset.chatMessageId = String(messageId);
    }
    if (type === 'user') {
      const content = document.createElement('div');
      content.className = 'chat-user-content';
      content.textContent = text || '';
      div.appendChild(content);
    } else if (type === 'assistant' || type === 'ai') {
      div.setAttribute('data-copyable', 'true');
      const content = document.createElement('div');
      content.className = 'chat-ai-content';
      content.setAttribute('data-copy-content', 'true');
      content.setAttribute('data-chat-selectable', 'true');
      content.innerHTML = renderLearningMarkdown(text);
      div.appendChild(content);
      div.appendChild(createCopyButton());
    } else {
      div.innerHTML = renderLearningMarkdown(text);
    }
    container.appendChild(div);
    if (imageGroup?.groupId) await this.renderImageGallery(div, imageGroup, messageId);
    container.scrollTop = container.scrollHeight;
  },

  // Add article card to DOM only (no history save)
  addArticleCardToDOM(article, messageId = '') {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'message ai-message';
    if (messageId) div.dataset.homeMessageId = String(messageId);

    const content = article.content || '';
    const preview = content.substring(0, 200) + (content.length > 200 ? '...' : '');
    const difficultyLabel = DIFFICULTY_LABELS[article.difficulty] || article.difficulty;

    div.innerHTML = `
      <div class="article-card">
        <div class="article-card-header">
          <span class="article-title">${esc(article.title)}</span>
          ${article.reviewMode ? '<span class="badge badge-review"><i class="fa-solid fa-rotate" aria-hidden="true"></i> 复习</span>' : ''}
          <span class="badge badge-${article.difficulty}">${difficultyLabel}</span>
          <span class="word-count">${article.wordCount} 词</span>
        </div>
        <div class="article-preview">${esc(preview)}</div>
        <a href="#/reading/${article.id}" class="btn btn-primary btn-sm">${article.reviewMode ? '开始复习阅读' : '阅读全文'}</a>
      </div>`;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  cleanup() {
    this.homeEpoch += 1;
    homeRequestGate.invalidate();
    this._imageRequestController?.abort();
    this._imageRequestController = null;
    this._guidedRequestController?.abort();
    this._guidedRequestController = null;
    chatService.cancel('home');
    this.resetGenerateButton();
    this.removeThinking();
    this.removeArticleGenerationStatus();
    this.releaseChatActions();
    if (this._generationPreviewTimer) clearTimeout(this._generationPreviewTimer);
    this._generationPreviewTimer = null;
    this._generationPreviewQueue.clear();
    const clearContextButton = document.getElementById('appClearContextBtn');
    if (clearContextButton && this._clearContextHandler) {
      clearContextButton.removeEventListener('click', this._clearContextHandler);
    }
    this._clearContextHandler = null;
    if (this._importHandler) {
      document.removeEventListener('article-imported', this._importHandler);
      this._importHandler = null;
    }
  }
};

/**
 * Word Import Module
 * Handles importing words from PDF or manual input
 */
export const WordImport = {
  currentPlan: null,
  _lastInputText: '',
  _pdfImportSequence: 0,
  _planSequence: 0,
  _planPromise: null,
  _executePromise: null,
  _importSource: 'manual',
  _importLimitExceeded: false,

  // Show import modal
  showModal({ source = 'manual', inputText = '', limitExceeded = false } = {}) {
    this._pdfImportSequence += 1;
    this._planSequence += 1;
    this._planPromise = null;
    this._executePromise = null;
    this.currentPlan = null;
    this._importSource = String(source || 'manual');
    this._importLimitExceeded = Boolean(limitExceeded);
    const existing = document.getElementById('wordImportModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'wordImportModal';
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) this.closeModal(); };

    overlay.innerHTML = `
      <div class="modal modal-wide">
        <h2>导入单词</h2>
        <div class="form-group">
          <label>导入方式</label>
          <select id="importMethod" onchange="WordImport.toggleMethod()">
            <option value="paste">手动粘贴</option>
            <option value="pdf">PDF 文件</option>
          </select>
        </div>
        <div id="pasteSection" class="form-group">
          <label>粘贴单词列表（每行一个单词，或用逗号/空格分隔）</label>
          <textarea id="wordPasteInput" rows="8" placeholder="apple\nbanana\ncomputer\n..."></textarea>
        </div>
        <div id="pdfSection" class="form-group" style="display:none">
          <label>选择 PDF 文件</label>
          <input type="file" id="pdfFileInput" accept=".pdf" onchange="WordImport.handlePdfUpload(event)">
          <div id="pdfStatus" role="status" aria-live="polite" style="margin-top:8px;font-size:13px;color:var(--text-muted)"></div>
        </div>
        <div id="wordImportStatus" role="status" aria-live="polite" style="margin-top:8px;font-size:13px;color:var(--text-muted)"></div>
        <div class="modal-actions">
          <button id="wordImportPreview" class="btn btn-primary" type="button" onclick="WordImport.handleImport()">预览导入</button>
          <button id="wordImportCancel" class="btn" type="button" onclick="WordImport.closeModal()">取消</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    const input = document.getElementById('wordPasteInput');
    if (inputText && input) input.value = inputText;
    input?.addEventListener('input', () => {
      if (this._importSource === 'pdf') {
        this._importSource = 'manual';
        this._importLimitExceeded = false;
      }
    });
  },

  closeModal() {
    this._pdfImportSequence += 1;
    this._planSequence += 1;
    this._planPromise = null;
    this._executePromise = null;
    this.currentPlan = null;
    document.getElementById('wordImportModal')?.remove();
  },

  // Toggle between paste and PDF methods
  toggleMethod() {
    const method = document.getElementById('importMethod')?.value;
    const pasteSection = document.getElementById('pasteSection');
    const pdfSection = document.getElementById('pdfSection');
    if (!method || !pasteSection || !pdfSection) return;
    pasteSection.style.display = method === 'paste' ? 'block' : 'none';
    pdfSection.style.display = method === 'pdf' ? 'block' : 'none';
  },

  // Handle PDF file upload
  async handlePdfUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    this._importSource = 'pdf';
    this._importLimitExceeded = false;
    const sequence = ++this._pdfImportSequence;
    const updateStatus = message => {
      if (sequence !== this._pdfImportSequence) return;
      const status = document.getElementById('pdfStatus');
      if (status) status.textContent = message;
      const importStatus = document.getElementById('wordImportStatus');
      if (importStatus) importStatus.textContent = message;
    };
    updateStatus('正在准备 PDF 解析器…');
    const span = diagnosticLogger()?.beginSpan('vocab.import_pdf', {
      category: 'vocabulary',
      correlationId: `vocab-import-pdf:${Date.now()}`,
      payload: { type: file.type || 'application/pdf', size: Number(file.size) || 0 }
    });

    try {
      const text = await this.extractPdfText(file, {
        onProgress: event => updateStatus(event?.message || '正在解析 PDF…')
      });
      if (sequence !== this._pdfImportSequence) {
        span?.end({ level: 'info', payload: { cancelled: true } });
        return;
      }
      const wordResult = this.extractWordsFromText(text, { limit: MAX_PDF_WORDS, returnMeta: true });
      const words = wordResult.words;
      this._importLimitExceeded = wordResult.truncated;
      document.getElementById('wordPasteInput').value = words.join('\n');
      const batchCount = Math.ceil(words.length / MAX_WORDS_PER_BATCH);
      updateStatus(wordResult.truncated
        ? `已识别超过 ${MAX_PDF_WORDS} 个唯一词，请拆分 PDF；当前预览被禁止确认。`
        : `已提取 ${words.length} 个单词，将分成 ${batchCount || 0} 批处理`);
      document.getElementById('importMethod').value = 'paste';
      this.toggleMethod();
      span?.end({ payload: { extractedCount: words.length, truncated: wordResult.truncated, batchCount } });
      diagnosticLogger()?.record('vocab.import_pdf', {
        category: 'vocabulary',
        correlationId: span?.correlationId,
        payload: { ok: true, extractedCount: words.length, truncated: wordResult.truncated, batchCount }
      });
    } catch (err) {
      span?.end({ level: 'error', payload: { name: err?.name || 'Error' } });
      diagnosticLogger()?.record('vocab.import_pdf', {
        category: 'vocabulary',
        level: 'error',
        correlationId: span?.correlationId,
        payload: { ok: false, name: err?.name || 'Error' }
      });
      if (sequence !== this._pdfImportSequence) return;
      updateStatus(`解析失败：${err?.message || '请重试。'}`);
      // Clearing the value allows the user to choose the same file again.
      if (event.target) event.target.value = '';
    }
  },

  // Extract text from PDF using pdf.js
  async extractPdfText(file, options = {}) {
    return pdfImportService.extractText(file, options);
  },

  // Load pdf.js library
  async loadPdfJs() {
    return pdfImportService.loadParser();
  },

  // Extract English words from text
  extractWordsFromText(text, options = {}) {
    return normalizeImportWords(text, options);
  },

  // Handle word import
  async handleImport() {
    if (this._planPromise) return this._planPromise;
    const input = document.getElementById('wordPasteInput');
    const text = input?.value.trim() || '';
    const status = document.getElementById('wordImportStatus');
    const previewButton = document.getElementById('wordImportPreview');
    const span = diagnosticLogger()?.beginSpan('vocab.import_plan', {
      category: 'vocabulary',
      correlationId: `vocab-import-plan:${Date.now()}`,
      payload: { inputLength: text.length }
    });
    const showError = message => {
      if (status) status.textContent = message;
      if (previewButton) {
        previewButton.disabled = false;
        previewButton.textContent = '预览导入';
      }
    };
    if (!text) {
      span?.end({ level: 'warn', payload: { reason: 'empty_input' } });
      showError('请输入或粘贴单词');
      alert('请输入或粘贴单词');
      return;
    }

    const wordResult = this.extractWordsFromText(text, {
      limit: this._importSource === 'pdf' ? MAX_PDF_WORDS : MAX_WORDS_PER_BATCH,
      returnMeta: true
    });
    if (wordResult.truncated || this._importLimitExceeded) {
      this._importLimitExceeded = true;
      const limit = this._importSource === 'pdf' ? MAX_PDF_WORDS : MAX_WORDS_PER_BATCH;
      const message = this._importSource === 'pdf'
        ? `超过 ${MAX_PDF_WORDS} 个唯一词，请拆分 PDF 后重试`
        : `普通导入最多 ${MAX_WORDS_PER_BATCH} 个唯一词，请分批粘贴后重试`;
      span?.end({ level: 'warn', payload: { reason: 'word_limit', limit } });
      showError(message);
      alert(message);
      return;
    }
    const words = wordResult.words;
    if (words.length === 0) {
      span?.end({ level: 'warn', payload: { reason: 'no_words' } });
      showError('未识别到有效单词');
      alert('未识别到有效单词');
      return;
    }
    const sequence = ++this._planSequence;
    if (previewButton) {
      previewButton.disabled = true;
      previewButton.textContent = '分析中…';
    }
    if (status) status.textContent = `正在分析 ${words.length} 个词…`;

    const task = (async () => {
      try {
        const plan = await wordImportService.createPlan(text, { source: this._importSource });
        if (sequence !== this._planSequence || !document.getElementById('wordImportModal')) {
          span?.end({ payload: { cancelled: true } });
          return;
        }
        this._lastInputText = text;
        this.renderImportPreview(plan);
        span?.end({ payload: { recognizedCount: plan.counts?.recognized || words.length, batchCount: plan.batchCount || 0 } });
        diagnosticLogger()?.record('vocab.import_plan', {
          category: 'vocabulary',
          correlationId: span?.correlationId,
          payload: { ok: true, recognizedCount: plan.counts?.recognized || words.length, batchCount: plan.batchCount || 0 }
        });
      } catch (error) {
        span?.end({ level: 'error', payload: { name: error?.name || 'Error' } });
        diagnosticLogger()?.record('vocab.import_plan', {
          category: 'vocabulary',
          level: 'error',
          correlationId: span?.correlationId,
          payload: { ok: false, name: error?.name || 'Error' }
        });
        if (sequence === this._planSequence) showError(`分析失败：${error?.message || '请重试。'}`);
      }
    })();
    const tracked = task.finally(() => {
      if (this._planPromise !== tracked) return;
      this._planPromise = null;
      const button = document.getElementById('wordImportPreview');
      if (button && !this.currentPlan) {
        button.disabled = false;
        button.textContent = '预览导入';
      }
    });
    this._planPromise = tracked;
    return tracked;
  },

  renderImportPreview(plan) {
    this.currentPlan = plan;
    const modal = document.querySelector('#wordImportModal .modal');
    if (!modal) return;
    const counts = plan.counts || {};
    const failed = plan.categories?.failed?.length || 0;
    const batchCount = Number(plan.batchCount) || 0;
    const limitWarning = plan.limitExceeded
      ? `<p class="word-import-limit-warning" role="alert">超过 ${Number(plan.wordLimit) || MAX_PDF_WORDS} 个唯一词，请拆分文件后再导入。</p>`
      : '';
    modal.innerHTML = `
      <h2>确认导入</h2>
      <div class="word-import-preview" aria-live="polite">
        <p class="word-import-preview-lead">已识别 ${counts.recognized || 0} 个有效词，确认后才会写入我的词汇${batchCount > 1 ? `，将分成 ${batchCount} 批处理` : ''}。</p>
        ${limitWarning}
        <div class="word-import-preview-grid">
          <div class="word-import-preview-row"><span>识别到的有效词</span><strong>${counts.recognized || 0}</strong></div>
          <div class="word-import-preview-row"><span>新增词</span><strong>${counts.new || 0}</strong></div>
          <div class="word-import-preview-row"><span>可计外部复习</span><strong>${counts.externalReview || 0}</strong></div>
          <div class="word-import-preview-row"><span>今日已处理</span><strong>${counts.todayIgnored || 0}</strong></div>
          <div class="word-import-preview-row"><span>无法识别</span><strong>${counts.invalid || 0}</strong></div>
          <div class="word-import-preview-row"><span>预分析失败</span><strong>${failed}</strong></div>
        </div>
        <div class="word-import-progress" role="status" aria-live="polite">等待确认：0/${counts.recognized || 0}${batchCount ? `（共 ${batchCount} 批）` : ''}</div>
      </div>
      <div class="modal-actions">
        <button id="wordImportConfirm" class="btn btn-primary" type="button" ${plan.limitExceeded ? 'disabled' : ''}>确认导入</button>
        <button id="wordImportBack" class="btn" type="button">返回修改</button>
      </div>`;
    modal.querySelector('#wordImportConfirm')?.addEventListener('click', () => this.confirmImport());
    modal.querySelector('#wordImportBack')?.addEventListener('click', () => {
      this.showModal({
        source: this.currentPlan?.source || this._importSource,
        inputText: this._lastInputText,
        limitExceeded: this.currentPlan?.limitExceeded || this._importLimitExceeded
      });
    });
  },

  async confirmImport() {
    if (!this.currentPlan) return;
    if (this.currentPlan.limitExceeded) return;
    if (this._executePromise) return this._executePromise;
    const span = diagnosticLogger()?.beginSpan('vocab.import_execute', {
      category: 'vocabulary',
      correlationId: `vocab-import-execute:${Date.now()}`,
      payload: { recognizedCount: this.currentPlan.counts?.recognized || 0 }
    });
    const modal = document.querySelector('#wordImportModal .modal');
    const confirm = modal?.querySelector('#wordImportConfirm');
    const back = modal?.querySelector('#wordImportBack');
    const progress = modal?.querySelector('.word-import-progress');
    if (confirm) confirm.disabled = true;
    if (back) back.disabled = true;
    const task = (async () => {
      try {
        const result = await wordImportService.execute(this.currentPlan, {
          onProgress: ({ processed, recognized, batchIndex, batchCount }) => {
            if (!progress) return;
            const batchText = batchCount ? `第 ${batchIndex}/${batchCount} 批，` : '';
            progress.textContent = `正在导入${batchText}${processed}/${recognized}`;
          }
        });
        const summary = result.summary || {};
        ChatView.addMessage('system', `导入完成：新增 ${summary.new || 0} 个，外部复习 ${summary.externalReview || 0} 个，调整排期 ${summary.scheduleAdjusted || 0} 个，Recovery 接触 ${summary.recoveryContact || 0} 个，今日已处理 ${summary.todayIgnored || 0} 个，失败 ${summary.failed || 0} 个。`);
        modal?.closest('#wordImportModal')?.remove();
        this.currentPlan = null;
        span?.end({ payload: { ok: true, newCount: summary.new || 0, failedCount: summary.failed || 0 } });
        diagnosticLogger()?.record('vocab.import', {
          category: 'vocabulary',
          correlationId: span?.correlationId,
          payload: { ok: true, newCount: summary.new || 0, externalReviewCount: summary.externalReview || 0, failedCount: summary.failed || 0 }
        });
      } catch (error) {
        span?.end({ level: 'error', payload: { name: error?.name || 'Error' } });
        diagnosticLogger()?.record('vocab.import', {
          category: 'vocabulary',
          level: 'error',
          correlationId: span?.correlationId,
          payload: { ok: false, name: error?.name || 'Error' }
        });
        if (progress) progress.textContent = `导入失败：${String(error?.message || error)}`;
        if (confirm) confirm.disabled = false;
        if (back) back.disabled = false;
      }
    })();
    const tracked = task.finally(() => {
      if (this._executePromise === tracked) this._executePromise = null;
    });
    this._executePromise = tracked;
    return tracked;
  }
};

const homeGenerationCoordinator = new HomeGenerationCoordinator({
  execute: (job, runtime) => ChatView.executeHomeGenerationJob(job, runtime),
  onStateChange: job => ChatView.syncHomeGenerationUI(job),
  onPreview: event => {
    const preview = Object.hasOwn(event || {}, 'preview') ? event.preview : event;
    const jobId = event?.jobId || preview?.jobId;
    if (!preview) {
      ChatView.removeHomeGenerationPreviews(jobId);
      return;
    }
    ChatView.queueHomeGenerationPreview(preview);
  }
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    void homeGenerationCoordinator.setVisibility(document.hidden ? 'hidden' : 'visible');
  });
}

window.ChatView = ChatView;
window.WordImport = WordImport;
window.ChatHistory = ChatHistory;
window.PendingArticles = PendingArticles;
