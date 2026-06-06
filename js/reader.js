// ===== 阅读页交互：单击查词、发音、AI句子分析 =====

function initReadingView() {
  const articleBody = document.getElementById('articleBody');
  if (!articleBody) return;

  // 单击查词
  articleBody.addEventListener('click', async (e) => {
    const tooltip = document.getElementById('wordTooltip');
    if (tooltip && tooltip.contains(e.target)) return;
    // 忽略"问 AI"按钮的点击
    if (e.target.id === 'aiAnalyzeBtn') return;

    hideTooltip();
    hideAnalyzeBtn();

    const word = getWordAtPoint(e);
    if (!word || word.length < 2) return;

    showTooltipLoading(e.clientX, e.clientY);

    try {
      const data = await lookupWord(word);
      showTooltip(e.clientX, e.clientY, data);
    } catch {
      hideTooltip();
    }
  });

  // 选中文本 → 显示"问 AI"按钮（支持桌面和移动端）
  let selectionTimer = null;

  function checkSelection() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const selection = window.getSelection();
      const text = selection.toString().trim();
      if (text.length > 3 && /[a-zA-Z]/.test(text)) {
        try {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          showAnalyzeBtn(rect.left + rect.width / 2, rect.bottom, text);
        } catch { hideAnalyzeBtn(); }
      } else {
        hideAnalyzeBtn();
      }
    }, 200);
  }

  // 桌面端：mouseup
  articleBody.addEventListener('mouseup', checkSelection);
  // 移动端：touchend
  articleBody.addEventListener('touchend', checkSelection);
  // selectionchange 作为兜底
  document.addEventListener('selectionchange', () => {
    if (document.getElementById('articleBody')) checkSelection();
  });

  // Tooltip 上的发音按钮（事件委托）
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-speak')) {
      const word = e.target.getAttribute('data-word');
      if (word) speakWord(word);
    }
  });
}

// ===== 单词发音（v1.0.6：修复 escapeHtml 崩溃 + 重试机制）=====

function speakWord(word) {
  if (!word) return;

  // 视觉反馈（用安全的方式找按钮，不依赖 escapeHtml）
  var btns = document.querySelectorAll('.btn-speak');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].getAttribute('data-word') === word) {
      btns[i].style.opacity = '0.5';
      setTimeout((function(b) { return function() { b.style.opacity = '1'; }; })(btns[i]), 800);
      break;
    }
  }

  // 方案1: 原生 TtsBridge（直接调 Android TTS，最可靠）
  if (window.TtsBridge) {
    window.TtsBridge.speak(word);
    return;
  }

  // 方案2: TtsBridge 可能还没注入，延迟重试（最多等 2 秒）
  _retryTtsBridge(word, 0);
}

function _retryTtsBridge(word, attempt) {
  if (attempt >= 5) {
    // 超时，走降级
    _fallbackSpeak(word);
    return;
  }
  if (window.TtsBridge) {
    window.TtsBridge.speak(word);
    return;
  }
  setTimeout(function() { _retryTtsBridge(word, attempt + 1); }, 400);
}

function _fallbackSpeak(word) {
  // Capacitor TTS 插件
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech) {
    window.Capacitor.Plugins.TextToSpeech.speak({
      text: word, lang: 'en-US', rate: 0.9, pitch: 1.0, volume: 1.0
    }).catch(function() {
      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(word));
      }
    });
    return;
  }

  // 桌面浏览器 SpeechSynthesis
  if ('speechSynthesis' in window) {
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(word);
      u.lang = 'en-US'; u.rate = 0.9; u.volume = 1.0;
      speechSynthesis.speak(u);
    } catch(e) {}
  }
}



// ===== 单击取词 =====
function getWordAtPoint(e) {
  let range;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(e.clientX, e.clientY);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.setEnd(pos.offsetNode, pos.offset);
    }
  }
  if (!range) return null;

  const node = range.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.textContent;
  const offset = range.startOffset;
  if (!text) return null;

  let start = offset, end = offset;
  while (start > 0 && /[a-zA-Z\-']/.test(text[start - 1])) start--;
  while (end < text.length && /[a-zA-Z\-']/.test(text[end])) end++;

  const word = text.substring(start, end).replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
  return word.length >= 2 ? word : null;
}

// ===== Tooltip =====
function showTooltipLoading(x, y) {
  const tooltip = document.getElementById('wordTooltip');
  tooltip.innerHTML = '<span style="color:#aaa">...</span>';
  positionTooltip(tooltip, x, y);
  tooltip.style.display = 'block';
}

function showTooltip(x, y, data) {
  const tooltip = document.getElementById('wordTooltip');
  let html = `<div class="tooltip-word">
    <span>${esc(data.word)}</span>
    <button class="btn-speak" data-word="${esc(data.word)}" title="播放发音">🔊</button>
  </div>`;
  if (data.baseForm) html += `<div class="tooltip-pos">原形: ${esc(data.baseForm)}</div>`;
  if (data.phonetic) html += `<div class="tooltip-phonetic">[${esc(data.phonetic)}]</div>`;
  if (data.pos) html += `<div class="tooltip-pos">${esc(data.pos)}</div>`;
  html += `<div class="tooltip-translation">${esc(data.translation)}</div>`;
  if (data.found) {
    html += `<div class="tooltip-actions">
      <button class="btn-save-word" onclick="saveWordFromTooltip('${escJs(data.word)}', '${escJs(data.translation)}', '${escJs(data.phonetic || '')}')">+ 收藏</button>
    </div>`;
  }
  tooltip.innerHTML = html;
  positionTooltip(tooltip, x, y);
  tooltip.style.display = 'block';
}

function positionTooltip(tooltip, x, y) {
  tooltip.style.left = '0';
  tooltip.style.top = '0';
  tooltip.style.display = 'block';
  const rect = tooltip.getBoundingClientRect();
  let left = x + 10;
  let top = y + 10;
  if (left + rect.width > window.innerWidth - 10) left = x - rect.width - 10;
  if (top + rect.height > window.innerHeight - 10) top = y - rect.height - 10;
  if (left < 10) left = 10;
  if (top < 10) top = 10;
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
}

function hideTooltip() {
  const tooltip = document.getElementById('wordTooltip');
  if (tooltip) tooltip.style.display = 'none';
}

// ===== AI 句子分析 =====
let currentSelectedText = '';

function showAnalyzeBtn(x, y, text) {
  hideAnalyzeBtn();
  currentSelectedText = text;
  const btn = document.createElement('button');
  btn.id = 'aiAnalyzeBtn';
  btn.className = 'ai-analyze-btn';
  btn.textContent = '问 AI';
  btn.onclick = (e) => {
    e.stopPropagation();
    handleAnalyzeSentence(text);
  };
  let left = x - 30;
  let top = y + 8;
  if (left < 10) left = 10;
  if (top + 40 > window.innerHeight) top = y - 40;
  btn.style.left = left + 'px';
  btn.style.top = top + 'px';
  document.body.appendChild(btn);
}

function hideAnalyzeBtn() {
  const btn = document.getElementById('aiAnalyzeBtn');
  if (btn) btn.remove();
}

async function handleAnalyzeSentence(sentence) {
  hideAnalyzeBtn();
  hideTooltip();

  showAIResultModal('正在分析...', true);

  try {
    const result = await analyzeSentenceWithAI(sentence);
    showAIResultModal(result, false);
  } catch (err) {
    showAIResultModal(`分析失败：${err.message}`, false);
  }
}

function showAIResultModal(content, isLoading) {
  const existing = document.getElementById('aiResultModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'aiResultModal';
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const modal = document.createElement('div');
  modal.className = 'modal modal-wide';
  modal.innerHTML = `
    <h2>AI 句子分析</h2>
    <div class="${isLoading ? 'ai-loading' : 'ai-result-content'}">${isLoading ? '正在分析，请稍候...' : formatAIResult(content)}</div>
    <div class="modal-actions">
      <button class="btn" onclick="document.getElementById('aiResultModal').remove()">关闭</button>
    </div>`;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function formatAIResult(text) {
  return esc(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// ===== 保存单词 =====
function getArticleId() {
  const hash = location.hash;
  const match = hash.match(/\/reading\/(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

async function saveWordFromTooltip(word, translation, phonetic) {
  try {
    await saveWord({
      articleId: getArticleId(),
      word,
      translation,
      phonetic,
      contextSentence: '',
    });
    const btn = document.querySelector('.btn-save-word');
    if (btn) { btn.textContent = '已收藏'; btn.disabled = true; }
  } catch {
    alert('收藏失败');
  }
}

function toggleTranslation() {
  const btn = document.getElementById('toggleTranslationBtn');
  const zhParas = document.querySelectorAll('.zh-paragraph');
  const showing = zhParas[0]?.style.display === 'none';
  zhParas.forEach(p => p.style.display = showing ? 'block' : 'none');
  btn.textContent = showing ? '隐藏翻译' : '显示翻译';
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function escJs(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}
