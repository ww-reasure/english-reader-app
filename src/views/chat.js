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
import { LEARNING_TOOLS, LearningAgent } from '../components/learning-agent.js';
import { ContextBuilder } from '../components/context-builder.js';
import { ChatService } from '../components/chat-service.js';
import { classifyComposerIntent } from '../components/composer-intent.js';
import { isGenerationAuthorized } from '../components/generation-authorization.mjs';
import { renderLearningMarkdown } from '../components/rich-text.js';
import { ArticleGenerationTool, GENERATE_READING_TOOL, admitArticle, normalizeTargetWords } from '../components/article-generation-tool.js';
import { resolveGenerationRequest } from '../components/generation-request.js';
import {
  createGenerationFailure as makeGenerationFailure,
  isCancelledGenerationRequest,
  normalizeGenerationFailure as hydrateGenerationFailure
} from '../components/generation-failure.mjs';
import { HomeRequestGate } from '../components/home-request-gate.mjs';
import { getSharedArticleQualityService } from '../components/article-quality-service.mjs';
import { planReviewBatches } from '../components/review-generation-plan.mjs';
import { buildArticleGenerationPolicy } from '../reading-personalization.mjs';
import { normalizeSelectableTrack, requiresTargetTrackSelection } from '../learning-track.mjs';
import { getDefinitionSenses, getSavableTranslation } from '../components/definition-trust.mjs';
import { DEFINITION_SCHEMA_VERSION } from '../components/saved-word-definition.mjs';

const conversationStore = new ConversationStore();
const learningAgent = new LearningAgent({ db: DB, srs: SpacedRepetition });
const contextBuilder = new ContextBuilder();
const chatService = new ChatService({ api: API, agent: learningAgent, builder: contextBuilder });
const articleQualityService = getSharedArticleQualityService({ api: API, db: DB });
const articleGenerationTool = new ArticleGenerationTool({
  api: API,
  db: DB,
  admit: admitArticle,
  inspectQuality: articleQualityService.inspectQuality
});
const generationPolicyFor = challenge => buildArticleGenerationPolicy({
  calibrationStatus: Config.get('calibration_status'),
  challenge,
  coverage: Config.get('coverage')
});
const HOME_LEARNING_TOOLS = [...LEARNING_TOOLS, GENERATE_READING_TOOL];
const homeRequestGate = new HomeRequestGate();
let generationFailureSequence = 0;
const nextGenerationFailureId = () => `generation-failure-${Date.now()}-${++generationFailureSequence}`;
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
  _generationController: null,
  _clearContextHandler: null,
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
    conversationStore.pruneExpiredArticleSessions(7 * 86400000);
    const topicOptions = this.topics.map(t =>
      `<option value="${t.value}">${t.label}</option>`
    ).join('');

    // The selected target is independent from the inferred reading mode.
    const savedExamLevel = ['cet4', 'cet6', 'kaoyan1', 'kaoyan2'].includes(Config.get('exam_level'))
      ? Config.get('exam_level')
      : '';
    const targetSelectPlaceholder = savedExamLevel
      ? ''
      : '<option value="" selected disabled>选择目标考试</option>';

    container.innerHTML = `
      <div class="chat-container">
        <div id="chatMessages" class="chat-messages">${this.studyAnchorMarkup()}</div>

        <footer class="chat-composer">
          <div id="quickActionRail" class="quick-action-rail" aria-label="快捷操作">
            <button class="quick-action" type="button" data-action="random"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>随机生成</button>
            <button class="quick-action" type="button" data-action="review"><i class="fa-solid fa-book-open" aria-hidden="true"></i>复习阅读</button>
            <button class="quick-action" type="button" data-action="topic" data-topic="technology"><i class="fa-solid fa-microchip" aria-hidden="true"></i>科技</button>
            <button class="quick-action" type="button" data-action="topic" data-topic="psychology"><i class="fa-solid fa-brain" aria-hidden="true"></i>心理学</button>
            <button class="quick-action" type="button" data-action="topic" data-topic="travel"><i class="fa-solid fa-plane" aria-hidden="true"></i>旅行</button>
            <button class="quick-action" type="button" data-action="import-article"><i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>导入文章</button>
            <button class="quick-action" type="button" data-action="import-words"><i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i>导入单词</button>
            <a class="quick-action" href="#/learn-words"><i class="fa-solid fa-bookmark" aria-hidden="true"></i>学习词库</a>
          </div>
          <div id="composerOptions" class="composer-options" hidden>
            <div class="composer-options-heading">
              <span>生成设置</span>
              <button id="composerOptionsClose" type="button" aria-label="关闭生成设置">×</button>
            </div>
            <select id="difficultySelect" name="difficulty" aria-label="文章难度">
              ${targetSelectPlaceholder}
              <option value="cet4" ${savedExamLevel === 'cet4' ? 'selected' : ''}>四级</option>
              <option value="cet6" ${savedExamLevel === 'cet6' ? 'selected' : ''}>六级</option>
              <option value="kaoyan1" ${savedExamLevel === 'kaoyan1' ? 'selected' : ''}>考研英语一</option>
              <option value="kaoyan2" ${savedExamLevel === 'kaoyan2' ? 'selected' : ''}>考研英语二</option>
            </select>
            <select id="topicSelect" class="topic-select" name="topic" aria-label="文章话题">
              <option value="">选择话题</option>
              ${topicOptions}
              <option value="custom">自定义...</option>
            </select>
            <input type="text" id="topicInput" name="customTopic" placeholder="自定义话题" class="input-small" autocomplete="off" style="display:none">
          </div>
          <div class="chat-input-row">
            <button id="composerOptionsBtn" class="composer-icon-btn" type="button" aria-label="打开生成设置" aria-expanded="false"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
            <textarea id="promptInput" name="learningPrompt" placeholder="问问题，或说“生成一篇关于……”" aria-label="学习问题" rows="1"></textarea>
            <button id="generateBtn" class="composer-generate-btn" type="button" aria-label="发送问题"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
          </div>
        </footer>
      </div>`;

    this.bindEvents();

    // Restore chat history
    await this.restoreHistory();

    // Show any pending articles from previous generation
    this.showPendingArticles();

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
      session.messages.forEach(message => {
        if (message.kind === 'article') {
          this.addArticleCardToDOM(message.article);
        } else if (message.kind === 'generation_failure') {
          this.addGenerationFailureToDOM(message.failure, message.id || message.createdAt);
        } else {
          this.addMessageToDOM(message.kind === 'notice' ? 'system' : message.kind === 'error' ? 'error' : message.role, message.content);
        }
      });
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

  // Clear chat history
  clearHistory() {
    if (!confirm('清除本次对话的上下文和显示记录？已保存的阅读文章不受影响。')) return;
    this.homeEpoch += 1;
    this.beginHomeRequest();
    conversationStore.clear('home');
    ChatHistory.clear();
    const container = document.getElementById('chatMessages');
    if (container) container.innerHTML = this.studyAnchorMarkup();
    this.addMessageToDOM('system', '对话已清空。现在可以开始新的学习问题。');
  },

  beginHomeRequest() {
    const requestVersion = homeRequestGate.begin();
    chatService.cancel('home');
    this._generationController?.abort();
    this._generationController = null;
    this.isReviewGenerating = false;
    this.resetGenerateButton();
    this.removeThinking();
    this.removeArticleGenerationStatus();
    return requestVersion;
  },

  isHomeRequestActive(epoch, requestVersion) {
    return this.homeEpoch === epoch && homeRequestGate.isCurrent(requestVersion);
  },

  startArticleGenerationSession(requestVersion = homeRequestGate.version) {
    this._generationController?.abort();
    const controller = new AbortController();
    const epoch = this.homeEpoch;
    this._generationController = controller;

    return {
      signal: controller.signal,
      isActive: () => this._generationController === controller && !controller.signal.aborted && this.isHomeRequestActive(epoch, requestVersion),
      release: () => {
        if (this._generationController === controller) this._generationController = null;
      }
    };
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
    const difficultySelect = document.getElementById('difficultySelect');
    if (difficultySelect) difficultySelect.value = target;
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

  // Show pending articles that were generated while user was away
  showPendingArticles() {
    const pending = PendingArticles.getAll();
    pending.forEach(({ article, reviewKeywords }) => {
      this.addArticleCard(article);
      if (reviewKeywords) {
        this.addMessage('system', `已自动融入学习词库中的单词：${reviewKeywords}`);
      }
    });
  },

  // Bind event listeners
  bindEvents() {
    document.getElementById('generateBtn').addEventListener('click', () => this.submitComposer());

    document.getElementById('promptInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitComposer();
      }
    });

    document.getElementById('composerOptionsBtn').addEventListener('click', () => this.toggleComposerOptions());
    document.getElementById('composerOptionsClose').addEventListener('click', () => this.toggleComposerOptions(false));
    const difficultySelect = document.getElementById('difficultySelect');
    difficultySelect.addEventListener('change', () => {
      this.commitGenerationTargetSelection({
        targetSelectionRequested: difficultySelect.value
      });
    });
    const clearContextButton = document.getElementById('appClearContextBtn');
    if (clearContextButton) {
      this._clearContextHandler = () => this.clearHistory();
      clearContextButton.addEventListener('click', this._clearContextHandler);
    }

    document.getElementById('quickActionRail').addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      const { action: name, topic } = action.dataset;
      if (name === 'random') {
        document.getElementById('promptInput').value = '';
        document.getElementById('topicSelect').value = '';
        document.getElementById('topicInput').style.display = 'none';
        this.handleGenerate();
      } else if (name === 'review') {
        this.handleReviewGenerate();
      } else if (name === 'topic') {
        const selectedTopic = this.topics.find(item => item.value === topic)?.label || topic;
        document.getElementById('promptInput').value = `请生成一篇关于${selectedTopic}的英语阅读文章。`;
        document.getElementById('topicInput').style.display = 'none';
        document.getElementById('promptInput').focus();
      } else if (name === 'import-article') {
        Modal.showImport();
      } else if (name === 'import-words') {
        WordImport.showModal();
      }
    });

    // Topic select change
    document.getElementById('topicSelect').addEventListener('change', (e) => {
      const customInput = document.getElementById('topicInput');
      if (e.target.value === 'custom') {
        customInput.style.display = 'block';
        customInput.focus();
      } else {
        customInput.style.display = 'none';
        customInput.value = '';
      }
    });
  },

  toggleComposerOptions(force) {
    const panel = document.getElementById('composerOptions');
    const button = document.getElementById('composerOptionsBtn');
    if (!panel || !button) return;
    const open = force ?? panel.hidden;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  },

  async submitComposer() {
    const input = document.getElementById('promptInput');
    const value = input?.value.trim();
    if (!value) return;
    if (!Config.hasApiKey()) {
      Modal.showApiSettings();
      return;
    }

    const epoch = this.homeEpoch;
    const requestVersion = this.beginHomeRequest();
    const isCurrentRequest = () => this.isHomeRequestActive(epoch, requestVersion);
    this.appendConversation({ role: 'user', kind: 'text', content: value });
    input.value = '';
    this.showThinking();
    try {
      const session = conversationStore.getSession('home');
      const reply = await chatService.ask({
        sessionKey: 'home',
        session,
        userMessage: value,
        kind: 'home',
        tools: HOME_LEARNING_TOOLS,
        executeTool: (name, args, context) => this.executeHomeTool(name, args, context, epoch, value, requestVersion)
      });
      if (!isCurrentRequest()) return;
      this.removeThinking();
      this.removeArticleGenerationStatus();
      if (reply.toolSupport === 'unsupported' && classifyComposerIntent(value) === 'generate') {
        return this.handleGenerate({ prompt: value, alreadyAdded: true, requestVersion });
      }
      if (reply.content) {
        this.appendConversation({ role: 'assistant', kind: 'text', content: reply.content });
      }
      reply.artifacts.forEach(artifact => {
        if (artifact.type === 'article') this.addArticleCard(artifact.article);
        if (artifact.type === 'generation_failure') this.addGenerationFailure(this.normalizeGenerationFailure(artifact.failure, value));
      });
    } catch (error) {
      if (!isCurrentRequest()) return;
      this.removeThinking();
      this.removeArticleGenerationStatus();
      this.appendConversation({ role: 'assistant', kind: 'error', content: '暂时无法回答，请稍后重试。' });
    }
  },

  async executeHomeTool(name, args = {}, { signal } = {}, epoch, userRequest = '', requestVersion) {
    if (name !== 'generate_reading') {
      return { result: await learningAgent.execute(name, args) };
    }
    if (!this.isHomeRequestActive(epoch, requestVersion) || signal?.aborted) throw cancelledRequest();
    const directUserRequest = String(userRequest || '').trim();
    if (!isGenerationAuthorized(directUserRequest)) {
      return { result: { status: 'generation_not_authorized' } };
    }
    const selectedDifficulty = document.getElementById('difficultySelect')?.value || Config.get('exam_level');
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

    if (generation.adjustment) this.addMessage('system', generationAdjustmentMessage(generation.adjustment));
    this.showArticleGenerationStatus(generationProgressLabel({ phase: 'drafting' }));
    try {
      const { article, metadata } = await articleGenerationTool.execute({
        request: generation.request,
        difficulty: generation.difficulty,
        challenge: generation.challenge,
        topic,
        wordCount: generation.wordCount
      }, {
        fallbackDifficulty: generation.difficulty,
        fallbackChallenge: generation.challenge,
        fallbackTopic: topic,
        legacyLevel: Config.get('level'),
        learningContext: this.buildGenerationContext({ excludeUserMessage: generation.request }),
        personalization: generationPolicy.personalization,
        validationOptions: generationPolicy.validationOptions,
        signal,
        isActive: () => this.isHomeRequestActive(epoch, requestVersion) && !signal?.aborted,
        onProgress: progress => {
          if (this.isHomeRequestActive(epoch, requestVersion) && !signal?.aborted) {
            this.showArticleGenerationStatus(generationProgressLabel(progress));
          }
        }
      });
      return { result: metadata, artifact: { type: 'article', article } };
    } catch (error) {
      if (isCancelledGenerationRequest(error) || signal?.aborted) throw error;
      const failure = this.createGenerationFailure(error, generation, topic);
      return {
        result: { status: failure.reason, summary: failure.message },
        artifact: { type: 'generation_failure', failure }
      };
    }
  },

  buildGenerationContext({ excludeUserMessage = '' } = {}) {
    const session = conversationStore.getSession('home');
    const duplicate = String(excludeUserMessage || '').replace(/\s+/g, ' ').trim();
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
    return [session.summary, recent].filter(Boolean).join('\n').slice(-1600);
  },

  // Get selected topic
  getTopic() {
    const select = document.getElementById('topicSelect')?.value;
    if (select === 'custom') {
      return document.getElementById('topicInput').value.trim() || 'general';
    }
    if (!select) return 'general';
    return this.topics.find(t => t.value === select)?.label || select;
  },

  // Handle article generation
  async handleGenerate({ prompt: providedPrompt, alreadyAdded = false, providedGeneration = null, topicOverride = '', suppressAdjustmentNotice = false, requestVersion = null, retryFailureId = '' } = {}) {
    if (!Config.hasApiKey()) {
      Modal.showApiSettings();
      return;
    }

    const generateButton = document.getElementById('generateBtn');
    if (generateButton?.disabled) return;

    const prompt = providedPrompt ?? providedGeneration?.request ?? document.getElementById('promptInput').value.trim();
    const directUserRequest = String(prompt || '').trim();
    const selectedDifficulty = document.getElementById('difficultySelect')?.value || Config.get('exam_level');
    const effectivePrompt = prompt || `请随机选择一个有趣的话题，生成一篇${DIFFICULTY_LABELS[selectedDifficulty]}难度的英语阅读文章。`;
    const generation = providedGeneration || this.resolveDirectGenerationRequest({
      request: effectivePrompt,
      selectedDifficulty,
      selectedChallenge: Config.get('reading_mode'),
      legacyLevel: Config.get('level'),
      allowExplicitUserTarget: Boolean(directUserRequest)
    });
    if (this.ensureTargetTrackBeforeGeneration()) return;
    const activeRequestVersion = requestVersion ?? this.beginHomeRequest();
    this.commitGenerationTargetSelection(generation);
    const difficulty = generation.difficulty;
    const topic = topicOverride || this.getTopic();
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
    const generationSession = this.startArticleGenerationSession(activeRequestVersion);
    this.showArticleGenerationStatus(generationProgressLabel({ phase: 'drafting' }));

    try {
      const { article: articleWithId, keywords } = await articleGenerationTool.execute({
        request: generation.request,
        difficulty,
        challenge: generation.challenge,
        topic,
        wordCount: generation.wordCount
      }, {
        fallbackDifficulty: difficulty,
        fallbackChallenge: generation.challenge,
        fallbackTopic: topic,
        legacyLevel: Config.get('level'),
        learningContext: this.buildGenerationContext({ excludeUserMessage: generation.request }),
        personalization: generationPolicy.personalization,
        validationOptions: generationPolicy.validationOptions,
        signal: generationSession.signal,
        isActive: generationSession.isActive,
        onProgress: progress => {
          if (generationSession.isActive()) {
            this.showArticleGenerationStatus(generationProgressLabel(progress));
          }
        }
      });
      if (!generationSession.isActive()) return;
      if (retryFailureId) this.removeGenerationFailure(retryFailureId);

      // Check if we're still on the chat page
      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) {
        this.addArticleCard(articleWithId);
        if (keywords) {
          this.addMessage('system', `已自动融入学习词库中的单词：${keywords}`);
        }
      } else {
        // User navigated away, save to pending queue
        PendingArticles.add(articleWithId, keywords);
      }
    } catch (err) {
      if (!generationSession.isActive()) return;
      if (isCancelledGenerationRequest(err)) return;
      const failure = this.createGenerationFailure(err, generation, topic);
      if (retryFailureId) this.replaceGenerationFailure(retryFailureId, failure);
      else this.addGenerationFailure(failure);
    } finally {
      if (generationSession.isActive()) {
        this.resetGenerateButton();
        this.removeArticleGenerationStatus();
      }
      if (retryFailureId) this.setGenerationFailureRetryState(retryFailureId, false);
      generationSession.release();
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
    const requestVersion = this.beginHomeRequest();
    const allArticles = await DB.getAllArticles();
    if (!this.isHomeRequestActive(epoch, requestVersion)) return;

    const plan = planReviewBatches({
      words: normalizedWords,
      articles: allArticles,
      maxArticles: 4
    });
    const selectedBatches = plan.batches;
    const selectedWords = plan.selectedWords;
    const effectiveDifficulty = difficulty || document.getElementById('difficultySelect')?.value || Config.get('exam_level') || 'cet4';
    if (!selectedBatches.length) {
      this.addMessage('system', `今天的${sourceLabel}已生成巩固阅读，稍后可直接开始阅读。`);
      return;
    }

    const generationPolicy = generationPolicyFor('support');
    const generationSession = this.startArticleGenerationSession(requestVersion);
    this.isReviewGenerating = true;
    const isReviewSessionActive = generationSession.isActive;
    const deferredCount = plan.remainingWords.length;
    this.addMessage('user', `🔄 复习阅读 | 难度：${DIFFICULTY_LABELS[effectiveDifficulty]}\n${sourceLabel} ${normalizedWords.length} 个词\n本次优先覆盖 ${selectedWords.length} 个词${deferredCount > 0 ? `，剩余 ${deferredCount} 个词可继续生成。` : '。'}`);

    const articles = [];
    let failedWordCount = 0;
    try {
      for (const [index, batch] of selectedBatches.entries()) {
        if (!isReviewSessionActive()) return;
        const coveredCount = articles.reduce((total, article) => total + (article.usedWords?.length || 0), 0);
        this.showArticleGenerationStatus(`正在制作第 ${index + 1}/${selectedBatches.length} 篇，已覆盖 ${coveredCount} 个词…`);
        const wordCount = selectedBatches.length > 1 ? 300 : 350;
        const request = `请生成一篇${selectedBatches.length > 1 ? '短文' : '文章'}，自然融入以下词汇：${batch.join(', ')}。${index > 0 ? '请选择与上一篇不同的主题。' : ''}`;
        try {
          const result = await articleGenerationTool.execute({
            request,
            difficulty: effectiveDifficulty,
            topic,
            wordCount
          }, {
            fallbackDifficulty: effectiveDifficulty,
            fallbackTopic: topic,
            fallbackChallenge: 'support',
            learningContext: this.buildGenerationContext(),
            personalization: generationPolicy.personalization,
            validationOptions: generationPolicy.validationOptions,
            signal: generationSession.signal,
            isActive: isReviewSessionActive,
            targetWords: batch,
            articleFields: { reviewMode: true, usedWords: batch }
          });
          if (!isReviewSessionActive()) {
            await this.discardReviewArticles([result.article]);
            return;
          }
          articles.push(result.article);
          this.publishReviewArticles([result.article], generationSession);
        } catch (error) {
          if (!isReviewSessionActive() || isCancelledGenerationRequest(error)) return;
          failedWordCount += batch.length;
          const failure = this.createGenerationFailure(error, {
            request,
            difficulty: effectiveDifficulty,
            challenge: 'support',
            wordCount
          }, topic);
          failure.message = `第 ${index + 1} 篇未完成：${failure.message}`;
          this.addGenerationFailure(failure);
        }
      }
      if (!isReviewSessionActive()) return;
      const coveredCount = articles.reduce((total, article) => total + (article.usedWords?.length || 0), 0);
      if (articles.length) {
        this.addMessage('system', `📝 已生成 ${articles.length} 篇巩固阅读，覆盖 ${coveredCount} 个待复习词。点击卡片即可开始阅读。`);
      } else if (failedWordCount) {
        this.addMessage('error', '本次复习阅读未能完成，请通过下方入口重试。');
      }
      if (deferredCount > 0 || failedWordCount > 0) {
        const remainingCount = deferredCount + failedWordCount;
        this.addReviewContinueAction(remainingCount, () => this.generateReviewReadings({
          reviewWords: normalizedWords,
          difficulty: effectiveDifficulty,
          topic,
          sourceLabel
        }));
      }
    } finally {
      if (isReviewSessionActive()) {
        this.removeArticleGenerationStatus();
        this.isReviewGenerating = false;
      }
      generationSession.release();
    }
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
    const reviewWords = normalizeTargetWords(
      [...dueWords, ...nonStableWords].map(word => word.word),
      Number.POSITIVE_INFINITY
    );
    return this.generateReviewReadings({
      reviewWords,
      difficulty: document.getElementById('difficultySelect')?.value || Config.get('exam_level') || 'cet4',
      topic: this.getTopic(),
      sourceLabel: '待复习词'
    });
  },

  appendConversation(message) {
    conversationStore.append('home', message);
    conversationStore.compact('home', 16);
    if (message.kind === 'article') {
      this.addArticleCardToDOM(message.article);
    } else if (message.kind === 'generation_failure') {
      this.addGenerationFailureToDOM(message.failure, message.id || message.createdAt);
    } else {
      const type = message.kind === 'notice' ? 'system' : message.kind === 'error' ? 'error' : message.role;
      this.addMessageToDOM(type, message.content);
    }
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

  createGenerationFailure(error, generation, topic) {
    return makeGenerationFailure(error, generation, topic);
  },

  normalizeGenerationFailure(failure, userRequest) {
    const selectedDifficulty = document.getElementById('difficultySelect')?.value || Config.get('exam_level') || 'cet4';
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
      conversationStore.compact('home', 16);
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
  addMessageToDOM(type, text) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `message ${type}-message`;
    if (type === 'user') div.textContent = text;
    else div.innerHTML = renderLearningMarkdown(text);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  // Add article card to DOM only (no history save)
  addArticleCardToDOM(article) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'message ai-message';

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
    chatService.cancel('home');
    this._generationController?.abort();
    this._generationController = null;
    this.isReviewGenerating = false;
    this.resetGenerateButton();
    this.removeThinking();
    this.removeArticleGenerationStatus();
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
  // Show import modal
  showModal() {
    const existing = document.getElementById('wordImportModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'wordImportModal';
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

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
          <div id="pdfStatus" style="margin-top:8px;font-size:13px;color:var(--text-muted)"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" onclick="WordImport.handleImport()">导入</button>
          <button class="btn" onclick="document.getElementById('wordImportModal').remove()">取消</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
  },

  // Toggle between paste and PDF methods
  toggleMethod() {
    const method = document.getElementById('importMethod').value;
    document.getElementById('pasteSection').style.display = method === 'paste' ? 'block' : 'none';
    document.getElementById('pdfSection').style.display = method === 'pdf' ? 'block' : 'none';
  },

  // Handle PDF file upload
  async handlePdfUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const status = document.getElementById('pdfStatus');
    status.textContent = '正在解析 PDF...';

    try {
      const text = await this.extractPdfText(file);
      const words = this.extractWordsFromText(text);
      document.getElementById('wordPasteInput').value = words.join('\n');
      status.textContent = `已提取 ${words.length} 个单词`;
      document.getElementById('importMethod').value = 'paste';
      this.toggleMethod();
    } catch (err) {
      status.textContent = `解析失败：${err.message}`;
    }
  },

  // Extract text from PDF using pdf.js
  async extractPdfText(file) {
    // Load pdf.js if not already loaded
    if (!window.pdfjsLib) {
      await this.loadPdfJs();
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }

    return fullText;
  },

  // Load pdf.js library
  async loadPdfJs() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  },

  // Extract English words from text
  extractWordsFromText(text) {
    const words = text.match(/[a-zA-Z]{2,}/g) || [];
    const unique = [...new Set(words.map(w => w.toLowerCase()))];
    return unique.filter(w => w.length >= 3).slice(0, 200);
  },

  // Handle word import
  async handleImport() {
    const text = document.getElementById('wordPasteInput').value.trim();
    if (!text) {
      alert('请输入或粘贴单词');
      return;
    }

    const words = this.extractWordsFromText(text);
    if (words.length === 0) {
      alert('未识别到有效单词');
      return;
    }

    // Show progress
    const status = document.createElement('div');
    status.style.cssText = 'margin-top:8px;font-size:13px;color:var(--text-muted)';
    document.getElementById('wordImportModal')?.querySelector('.modal-actions')?.before(status);

    let imported = 0;
    for (const word of words) {
      try {
        // Look up translation for each word
        let definition = null;
        try {
          definition = await Dictionary.lookup(word);
        } catch {}
        await DB.saveLearnWord({
          word,
          translation: getSavableTranslation(definition),
          phonetic: definition?.phonetic || '',
          pos: definition?.pos || '',
          definitionSenses: getDefinitionSenses(definition),
          definitionSchemaVersion: DEFINITION_SCHEMA_VERSION,
          definitionLexiconVersion: definition?.lexiconVersion || '',
          createdAt: Date.now()
        });
        imported++;
        if (status) status.textContent = `正在导入... ${imported}/${words.length}`;
      } catch {
        // Duplicate word, skip
      }
    }

    document.getElementById('wordImportModal')?.remove();
    ChatView.addMessage('system', `成功导入 ${imported} 个单词到学习词库`);
  }
};

window.ChatView = ChatView;
window.WordImport = WordImport;
window.ChatHistory = ChatHistory;
window.PendingArticles = PendingArticles;
