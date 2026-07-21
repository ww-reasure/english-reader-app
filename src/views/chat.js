/**
 * Chat View
 * Handles article generation with preset topics and smart word integration
 */

import { Config } from '../config.js';
import { DIFFICULTY_LABELS, esc, shuffleArray } from '../helpers.js';
import { DB } from '../db.js';
import { API } from '../api.js';
import { Modal } from '../components/modal.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { AudioCache } from '../audio-cache.js';
import { Dictionary } from '../dictionary.js';
import { ConversationStore } from '../components/conversation-store.js';
import { LearningAgent } from '../components/learning-agent.js';
import { ContextBuilder } from '../components/context-builder.js';
import { ChatService } from '../components/chat-service.js';
import { classifyComposerIntent } from '../components/composer-intent.js';

const conversationStore = new ConversationStore();
const learningAgent = new LearningAgent({ db: DB, srs: SpacedRepetition });
const contextBuilder = new ContextBuilder();
const chatService = new ChatService({ api: API, agent: learningAgent, builder: contextBuilder });

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

    // Get saved exam level from assessment or default
    const savedExamLevel = Config.get('exam_level') || 'cet4';

    container.innerHTML = `
      <div class="chat-container">
        <div id="chatMessages" class="chat-messages"></div>

        <footer class="chat-composer">
          <div id="quickActionRail" class="quick-action-rail" aria-label="快捷操作">
            <button class="quick-action" type="button" data-action="random">随机生成</button>
            <button class="quick-action" type="button" data-action="review">复习阅读</button>
            <button class="quick-action" type="button" data-action="topic" data-topic="technology">科技</button>
            <button class="quick-action" type="button" data-action="topic" data-topic="psychology">心理学</button>
            <button class="quick-action" type="button" data-action="topic" data-topic="travel">旅行</button>
            <button class="quick-action" type="button" data-action="import-article">导入文章</button>
            <button class="quick-action" type="button" data-action="import-words">导入单词</button>
            <a class="quick-action" href="#/learn-words">学习词库</a>
          </div>
          <div id="composerOptions" class="composer-options" hidden>
            <div class="composer-options-heading">
              <span>生成设置</span>
              <button id="composerOptionsClose" type="button" aria-label="关闭生成设置">×</button>
            </div>
            <select id="difficultySelect" name="difficulty" aria-label="文章难度">
              <option value="cet4" ${savedExamLevel === 'cet4' ? 'selected' : ''}>四级</option>
              <option value="cet6" ${savedExamLevel === 'cet6' ? 'selected' : ''}>六级</option>
              <option value="graduate" ${savedExamLevel === 'graduate' ? 'selected' : ''}>考研</option>
            </select>
            <select id="topicSelect" class="topic-select" name="topic" aria-label="文章话题">
              <option value="">选择话题</option>
              ${topicOptions}
              <option value="custom">自定义...</option>
            </select>
            <input type="text" id="topicInput" name="customTopic" placeholder="自定义话题" class="input-small" autocomplete="off" style="display:none">
          </div>
          <div class="chat-input-row">
            <button id="composerOptionsBtn" class="composer-icon-btn" type="button" aria-label="打开生成设置" aria-expanded="false">＋</button>
            <textarea id="promptInput" name="learningPrompt" placeholder="问问题，或说“生成一篇关于……”" aria-label="学习问题" rows="1"></textarea>
            <button id="generateBtn" class="composer-generate-btn" type="button" aria-label="发送问题">↑</button>
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
            📢 你有 <strong>${dueCount}</strong> 个单词需要复习
            <a href="#/flashcard" class="btn btn-primary btn-sm">开始复习</a>
          </div>`;
        container.insertBefore(div, container.firstChild);
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
        <p>首次使用建议先进行<strong>阅读水平测评</strong>，系统会根据你的词汇量自动推荐最佳难度和生词比例。</p>
        <div class="welcome-actions">
          <a href="#/assessment" class="btn btn-primary btn-sm">开始测评（约 3 分钟）</a>
          <button class="btn btn-outline btn-sm" onclick="ChatView.skipAssessment()">跳过，直接使用</button>
        </div>
      </div>`;
    container.appendChild(div);
  },

  // Skip assessment
  skipAssessment() {
    Config.set('assessment_done', 'true');
    const container = document.getElementById('chatMessages');
    if (container) container.innerHTML = '';
    this.addMessageToDOM('system', '已跳过测评。现在可以直接问我词汇、语法、阅读方法或复习计划；想读新文章时，说“生成一篇……”即可。<br>随时可以在「设置」中完成测评。');
  },

  // Clear chat history
  clearHistory() {
    if (!confirm('确定要清空对话历史吗？')) return;
    chatService.cancel('home');
    conversationStore.clear('home');
    ChatHistory.clear();
    const container = document.getElementById('chatMessages');
    if (container) container.innerHTML = '';
    this.addMessageToDOM('system', '对话已清空。现在可以开始新的学习问题。');
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

    this.appendConversation({ role: 'user', kind: 'text', content: value });
    input.value = '';
    if (classifyComposerIntent(value) === 'generate') {
      return this.handleGenerate({ prompt: value, alreadyAdded: true });
    }
    this.showThinking();
    try {
      const session = conversationStore.getSession('home');
      const reply = await chatService.ask({
        sessionKey: 'home',
        session,
        userMessage: value,
        kind: 'home'
      });
      this.removeThinking();
      this.appendConversation({ role: 'assistant', kind: 'text', content: reply.content });
    } catch (error) {
      this.removeThinking();
      this.appendConversation({ role: 'assistant', kind: 'error', content: '暂时无法回答：' + error.message });
    }
  },

  buildGenerationContext() {
    const session = conversationStore.getSession('home');
    const recent = session.messages
      .filter(message => message.kind === 'text')
      .slice(-6)
      .map(message => `${message.role === 'user' ? '学习者' : '助手'}：${message.content}`)
      .join('\n');
    return [session.summary, recent].filter(Boolean).join('\n').slice(-1600);
  },

  // Get selected topic
  getTopic() {
    const select = document.getElementById('topicSelect').value;
    if (select === 'custom') {
      return document.getElementById('topicInput').value.trim() || 'general';
    }
    if (!select) return 'general';
    return this.topics.find(t => t.value === select)?.label || select;
  },

  // Handle article generation
  async handleGenerate({ prompt: providedPrompt, alreadyAdded = false } = {}) {
    if (!Config.hasApiKey()) {
      Modal.showApiSettings();
      return;
    }

    const generateButton = document.getElementById('generateBtn');
    if (generateButton?.disabled) return;

    const prompt = providedPrompt ?? document.getElementById('promptInput').value.trim();
    const difficulty = document.getElementById('difficultySelect').value;
    const topic = this.getTopic();
    const userKeywords = document.getElementById('topicInput').value.trim();

    // Empty prompt = random generation
    const effectivePrompt = prompt || `请随机选择一个有趣的话题，生成一篇${DIFFICULTY_LABELS[difficulty]}难度的英语阅读文章。`;

    // Get words from learn library for review
    const learnWords = await DB.getAllLearnWords();
    let reviewKeywords = '';
    if (learnWords.length > 0) {
      const selected = shuffleArray(learnWords).slice(0, 8);
      reviewKeywords = selected.map(w => w.word).join(', ');
    }

    // Combine user keywords with review words
    const allKeywords = [userKeywords, reviewKeywords].filter(Boolean).join(', ');

    if (!alreadyAdded) {
      this.addMessage('user', prompt
        ? prompt
        : `请随机生成一篇${DIFFICULTY_LABELS[difficulty]}难度的英语阅读文章。`);
    }

    if (generateButton) {
      generateButton.disabled = true;
      generateButton.textContent = '…';
      generateButton.setAttribute('aria-label', '正在生成阅读');
    }

    // Clear input immediately
    const promptInput = document.getElementById('promptInput');
    if (promptInput) promptInput.value = '';

    try {
      const article = await API.generateArticle(
        effectivePrompt,
        difficulty,
        topic,
        allKeywords,
        400,
        this.buildGenerationContext()
      );
      const id = await DB.saveArticle(article);
      const articleWithId = { ...article, id };

      // Check if we're still on the chat page
      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) {
        this.addArticleCard(articleWithId);
        if (reviewKeywords) {
          this.addMessage('system', `已自动融入学习词库中的单词：${reviewKeywords}`);
        }
      } else {
        // User navigated away, save to pending queue
        PendingArticles.add(articleWithId, reviewKeywords);
      }
    } catch (err) {
      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) {
        this.addMessage('error', `错误：${err.message}`);
      }
    } finally {
      if (generateButton) {
        generateButton.disabled = false;
        generateButton.textContent = '↑';
        generateButton.setAttribute('aria-label', '发送问题');
      }
    }
  },

  // Handle review reading generation
  async handleReviewGenerate() {
    if (this.isReviewGenerating || !Config.hasApiKey()) {
      if (!Config.hasApiKey()) Modal.showApiSettings();
      return;
    }

    // Collect review words: due words + non-mastered learn words
    const allLearnWords = await DB.getAllLearnWords();
    const dueWords = SpacedRepetition.getDueWords(allLearnWords);
    const nonMastered = allLearnWords.filter(w => SpacedRepetition.getStatus(w) !== 'mastered');

    // Merge and dedup
    const wordSet = new Set();
    const reviewWords = [];
    [...dueWords, ...nonMastered].forEach(w => {
      if (!wordSet.has(w.word)) {
        wordSet.add(w.word);
        reviewWords.push(w.word);
      }
    });

    if (reviewWords.length === 0) {
      this.addMessage('system', '没有待复习的单词。先导入单词或在阅读中收藏单词。');
      return;
    }

    const difficulty = document.getElementById('difficultySelect').value;
    const topic = this.getTopic();
    this.isReviewGenerating = true;

    this.addMessage('user', `🔄 复习阅读 | 难度：${DIFFICULTY_LABELS[difficulty]}\n待复习 ${reviewWords.length} 个词`);

    try {
      const article = await API.generateReviewArticle(reviewWords, difficulty, topic);
      const id = await DB.saveArticle({ ...article, reviewMode: true });
      const articleWithId = { ...article, id, reviewMode: true };

      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) {
        this.addArticleCard(articleWithId);
        const usedCount = article.usedWords?.length || 0;
        this.addMessage('system', `📝 已从 ${reviewWords.length} 个待复习词中挑选 ${usedCount} 个融入文章，点击阅读开始复习`);
      } else {
        PendingArticles.add(articleWithId);
      }
    } catch (err) {
      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) {
        this.addMessage('error', `错误：${err.message}`);
      }
    } finally {
      this.isReviewGenerating = false;
    }
  },

  appendConversation(message) {
    conversationStore.append('home', message);
    conversationStore.compact('home', 16);
    if (message.kind === 'article') {
      this.addArticleCardToDOM(message.article);
    } else {
      const type = message.kind === 'notice' ? 'system' : message.kind === 'error' ? 'error' : message.role;
      this.addMessageToDOM(type, message.content);
    }
  },

  showThinking() {
    const container = document.getElementById('chatMessages');
    if (!container || document.getElementById('chatThinking')) return;
    const thinking = document.createElement('div');
    thinking.id = 'chatThinking';
    thinking.className = 'message ai-message chat-thinking';
    thinking.textContent = '正在整理你的学习信息…';
    container.appendChild(thinking);
    container.scrollTop = container.scrollHeight;
  },

  removeThinking() {
    document.getElementById('chatThinking')?.remove();
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

  // Add message to DOM only (no history save)
  addMessageToDOM(type, text) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `message ${type}-message`;
    div.textContent = text;
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
          ${article.reviewMode ? '<span class="badge badge-review">🔄 复习</span>' : ''}
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
    chatService.cancel('home');
    this.removeThinking();
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
        let translation = '';
        try {
          const dictResult = await Dictionary.lookup(word);
          translation = dictResult.translation || '';
        } catch {}
        await DB.saveLearnWord({ word, translation, createdAt: Date.now() });
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
