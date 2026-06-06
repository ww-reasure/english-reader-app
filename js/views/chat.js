/**
 * Chat View
 * Handles article generation with preset topics and smart word integration
 */

// Chat history persistence
const ChatHistory = {
  KEY: 'chatHistory',
  MAX_MESSAGES: 100,

  save(messages) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(messages.slice(-this.MAX_MESSAGES)));
    } catch {}
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
const PendingArticles = {
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
    const badge = document.getElementById('chatBadge');
    if (badge) {
      badge.style.display = this.queue.length > 0 ? 'block' : 'none';
      badge.textContent = this.queue.length;
    }
  }
};

const ChatView = {
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
  render(container) {
    const topicOptions = this.topics.map(t =>
      `<option value="${t.value}">${t.label}</option>`
    ).join('');

    // Get saved exam level from assessment or default
    const savedExamLevel = Config.get('exam_level') || 'cet4';

    container.innerHTML = `
      <div class="chat-container">
        <div id="chatMessages" class="chat-messages"></div>
        <div class="chat-input-area">
          <div class="input-options">
            <select id="difficultySelect">
              <option value="cet4" ${savedExamLevel === 'cet4' ? 'selected' : ''}>四级</option>
              <option value="cet6" ${savedExamLevel === 'cet6' ? 'selected' : ''}>六级</option>
              <option value="graduate" ${savedExamLevel === 'graduate' ? 'selected' : ''}>考研</option>
            </select>
            <select id="topicSelect" class="topic-select">
              <option value="">选择话题</option>
              ${topicOptions}
              <option value="custom">自定义...</option>
            </select>
            <input type="text" id="topicInput" placeholder="自定义话题" class="input-small" style="display:none">
          </div>
          <div class="input-row">
            <textarea id="promptInput" placeholder="描述你想要的文章..." rows="2"></textarea>
            <button id="generateBtn" class="btn btn-primary">生成</button>
          </div>
          <div class="input-actions">
            <button class="btn btn-outline btn-sm" onclick="Modal.showImport()">导入文章</button>
            <button class="btn btn-outline btn-sm" onclick="WordImport.showModal()">导入单词</button>
            <a href="#/learn-words" class="btn btn-outline btn-sm">学习词库</a>
            <button class="btn btn-outline btn-sm" onclick="ChatView.clearHistory()">清空对话</button>
          </div>
        </div>
      </div>`;

    this.bindEvents();

    // Restore chat history
    this.restoreHistory();

    // Show any pending articles from previous generation
    this.showPendingArticles();
  },

  // Restore chat history from localStorage
  restoreHistory() {
    const history = ChatHistory.load();
    if (history.length === 0) {
      // Show welcome message with assessment option for first-time users
      const assessmentDone = Config.get('assessment_done') === 'true';
      if (assessmentDone) {
        this.addMessageToDOM('system', '欢迎回来！选择话题和难度，描述你想阅读的内容。');
      } else {
        this.addWelcomeWithAssessment();
      }
      return;
    }

    history.forEach(msg => {
      if (msg.type === 'article') {
        this.addArticleCardToDOM(msg.article);
      } else {
        this.addMessageToDOM(msg.type, msg.text);
      }
    });
  },

  // Show welcome message with assessment CTA
  addWelcomeWithAssessment() {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'message system-message';
    div.innerHTML = `
      <div class="welcome-box">
        <h3>👋 欢迎使用英语阅读助手</h3>
        <p>首次使用建议先进行<strong>阅读水平测评</strong>，系统会根据你的词汇量自动推荐最佳难度和生词比例。</p>
        <div class="welcome-actions">
          <a href="#/assessment" class="btn btn-primary btn-sm">📊 开始测评（3分钟）</a>
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
    this.addMessageToDOM('system', '已跳过测评。选择话题和难度，描述你想阅读的内容。<br>也可以导入单词，AI 会自动在文章中使用这些单词帮助你复习。<br>随时可以在「设置」页面进行测评。');
  },

  // Clear chat history
  clearHistory() {
    if (!confirm('确定要清空对话历史吗？')) return;
    ChatHistory.clear();
    const container = document.getElementById('chatMessages');
    if (container) container.innerHTML = '';
    this.addMessageToDOM('system', '对话已清空');
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
    // Generate button
    document.getElementById('generateBtn').addEventListener('click', () => this.handleGenerate());

    // Enter key to generate
    document.getElementById('promptInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleGenerate();
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
  async handleGenerate() {
    if (!Config.hasApiKey()) {
      Modal.showApiSettings();
      return;
    }

    const prompt = document.getElementById('promptInput').value.trim();
    if (!prompt) return;

    const difficulty = document.getElementById('difficultySelect').value;
    const topic = this.getTopic();
    const userKeywords = document.getElementById('topicInput').value.trim();

    // Get words from learn library for review
    const learnWords = await DB.getAllLearnWords();
    let reviewKeywords = '';
    if (learnWords.length > 0) {
      const selected = shuffleArray(learnWords).slice(0, 8);
      reviewKeywords = selected.map(w => w.word).join(', ');
    }

    // Combine user keywords with review words
    const allKeywords = [userKeywords, reviewKeywords].filter(Boolean).join(', ');

    this.addMessage('user', `话题：${topic} | 难度：${DIFFICULTY_LABELS[difficulty]}\n${prompt}`);

    const btn = document.getElementById('generateBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '生成中...';
    }

    // Clear input immediately
    const promptInput = document.getElementById('promptInput');
    if (promptInput) promptInput.value = '';

    try {
      const article = await API.generateArticle(prompt, difficulty, topic, allKeywords);
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
      const btn = document.getElementById('generateBtn');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '生成';
      }
    }
  },

  // Add a chat message (with history save)
  addMessage(type, text) {
    this.addMessageToDOM(type, text);
    // Save to history
    const history = ChatHistory.load();
    history.push({ type, text });
    ChatHistory.save(history);
  },

  // Add article card to chat (with history save)
  addArticleCard(article) {
    this.addArticleCardToDOM(article);
    // Save to history
    const history = ChatHistory.load();
    history.push({ type: 'article', article: { id: article.id, title: article.title, difficulty: article.difficulty, wordCount: article.wordCount, content: article.content } });
    ChatHistory.save(history);
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

    const preview = article.content.substring(0, 200) + (article.content.length > 200 ? '...' : '');
    const difficultyLabel = DIFFICULTY_LABELS[article.difficulty] || article.difficulty;

    div.innerHTML = `
      <div class="article-card">
        <div class="article-card-header">
          <span class="article-title">${esc(article.title)}</span>
          <span class="badge badge-${article.difficulty}">${difficultyLabel}</span>
          <span class="word-count">${article.wordCount} 词</span>
        </div>
        <div class="article-preview">${esc(preview)}</div>
        <a href="#/reading/${article.id}" class="btn btn-primary btn-sm">阅读全文</a>
      </div>`;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }
};

/**
 * Word Import Module
 * Handles importing words from PDF or manual input
 */
const WordImport = {
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

    let imported = 0;
    for (const word of words) {
      try {
        await DB.saveLearnWord({ word, createdAt: Date.now() });
        imported++;
      } catch {
        // Duplicate word, skip
      }
    }

    document.getElementById('wordImportModal').remove();
    ChatView.addMessage('system', `成功导入 ${imported} 个单词到学习词库`);
  }
};
