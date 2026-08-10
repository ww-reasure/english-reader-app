/**
 * Settings View
 * Manages app settings: difficulty level, API configuration
 */

import { Config } from '../config.js';
import { Theme } from '../theme.js';
import { AudioCache } from '../audio-cache.js';
import { esc } from '../helpers.js';
import { listSelectableTracks, normalizeSelectableTrack } from '../learning-track.mjs';
import { CHALLENGE_DETAILS, normalizeCoveragePreference } from '../difficulty-profile.mjs';
import { createWebResearch } from '../components/web-research.mjs';
import { createDeepSeekResponsesClient, isDeepSeekNativeSearchSupported } from '../components/deepseek-responses.mjs';

export const SettingsView = {
  // Render settings page
  render(container) {
    const currentTheme = Config.get('theme') || 'light';
    const examWordLookupEnabled = Config.get('exam_word_lookup_enabled') !== 'false';
    const storedTrack = Config.get('exam_level');
    const targetMigrationRequired = Config.get('target_track_selection_required') === 'true' || storedTrack === 'graduate';
    // A legacy or unselected target must remain visibly unselected. Falling
    // back to CET-4 here would turn a migration prompt into an implicit choice.
    const currentTrack = targetMigrationRequired ? '' : (normalizeSelectableTrack(storedTrack) || 'cet4');
    const currentMode = ['support', 'standard', 'stretch'].includes(Config.get('reading_mode'))
      ? Config.get('reading_mode')
      : Config.get('level') === 'hard' ? 'stretch' : Config.get('level') === 'easy' ? 'support' : 'standard';
    const coveragePreference = normalizeCoveragePreference(currentMode, Config.get('coverage'));
    const calibrationStatus = Config.get('calibration_status') || 'new';
    const hasCurrentCalibration = calibrationStatus === 'calibrated';
    // Old assessments only stored a presentation-level difficulty preference.  They
    // cannot be treated as evidence for a learner's word knowledge or coverage.
    const hasLegacyAssessment = calibrationStatus === 'legacy'
      || (!hasCurrentCalibration && Config.get('assessment_done') === 'true');
    const assessmentDate = Config.get('assessment_date') || '';
    const currentModeDetails = CHALLENGE_DETAILS[currentMode];
    const trackOptions = listSelectableTracks().map(track => `
      <label class="settings-radio settings-target-option">
        <input type="radio" name="targetTrack" value="${track.id}" ${currentTrack === track.id ? 'checked' : ''}>
        <span class="settings-radio-label">
          <span class="settings-radio-title">${track.label}</span>
          <span class="settings-radio-desc">${track.description}</span>
        </span>
      </label>`).join('');
    const calibrationSection = hasCurrentCalibration ? `
        <div class="settings-section">
          <h2 class="settings-section-title">📊 初测后的材料建议</h2>
          <div class="assessment-result-card">
            <div class="assessment-result-info">
              <span>当前推荐：<strong>${currentModeDetails.label}</strong></span>
              <span class="text-muted">证据收集中，暂不承诺实际覆盖。</span>
              <span class="text-muted">初测用于建立起点；完成更多有效阅读与复习后，系统才会判断材料匹配证据是否充分。</span>
              <span class="text-muted">${assessmentDate ? '初测时间：' + new Date(assessmentDate).toLocaleDateString('zh-CN') : ''}</span>
            </div>
            <button class="btn btn-outline btn-sm" onclick="location.hash='#/assessment'">重新进行初测</button>
          </div>
        </div>` : hasLegacyAssessment ? `
        <div class="settings-section">
          <h2 class="settings-section-title">📊 历史测评记录</h2>
          <div class="assessment-result-card">
            <div class="assessment-result-info">
              <span>旧版测评只保留了材料难度偏好，不能作为当前词汇掌握或实际覆盖的证据。</span>
              <span class="text-muted">完成新的分层自适应初测后，系统才会开始收集可用于材料匹配的学习证据。</span>
              <span class="text-muted">${assessmentDate ? '历史测评时间：' + new Date(assessmentDate).toLocaleDateString('zh-CN') : ''}</span>
            </div>
            <button class="btn btn-outline btn-sm" onclick="location.hash='#/assessment'">开始新的初测</button>
          </div>
        </div>` : `
        <div class="settings-section">
          <h2 class="settings-section-title">📊 3 分钟阅读校准</h2>
          <p class="settings-desc">24 道分层自适应词义题加一篇短阅读理解，用于推荐材料压力；不会给出不可靠的“词汇量”数字。也可以跳过，先以保守材料目标阅读。</p>
          <button class="btn btn-primary" onclick="location.hash='#/assessment'">开始初测</button>
        </div>`;

    container.innerHTML = `
      <section class="app-standard-page settings-container" aria-labelledby="settingsContentTitle">
        <h2 id="settingsContentTitle" class="sr-only">设置内容</h2>
        <header class="page-heading app-route-heading">
          <p class="page-eyebrow">05 / WORKSPACE</p>
          <h1 class="page-title">设置</h1>
          <p class="page-desc">调整你的阅读节奏、主题与生成方式。</p>
        </header>

        ${targetMigrationRequired ? `
        <div class="settings-section settings-migration-note" role="status">
          <h2 class="settings-section-title">选择新的考研目标</h2>
          <p class="settings-desc">旧版“考研”文章会继续保留旧标签。请为今后生成的文章选择考研英语一或英语二；系统不会猜测或改写历史文章。</p>
        </div>` : ''}

        ${calibrationSection}

        <div class="settings-section">
          <h2 class="settings-section-title">目标考试导向</h2>
          <p class="settings-desc">这是你想练习的固定目标；阅读匹配方式只改变材料的相对压力，不会替你更改目标考试。</p>
          <div class="settings-options">
            ${trackOptions}
          </div>
        </div>

        <div class="settings-section">
          <h2 class="settings-section-title">真题练习</h2>
          <div class="settings-switch-row">
            <div class="settings-switch-copy">
              <strong>做题时点词翻译</strong>
              <span>控制作答过程中的英文点词查词；提交后查看解析时始终可用。</span>
            </div>
            <label class="settings-switch-control">
              <span class="sr-only">做题时点词翻译</span>
              <input id="settingsExamWordLookup" type="checkbox" role="switch" aria-checked="${examWordLookupEnabled ? 'true' : 'false'}" ${examWordLookupEnabled ? 'checked' : ''}>
              <b id="settingsExamWordLookupState">${examWordLookupEnabled ? '开' : '关'}</b>
            </label>
          </div>
        </div>

        <div class="settings-section">
          <h2 class="settings-section-title">阅读匹配方式</h2>
          <p class="settings-desc">系统会结合初测、复习证据和有效阅读提出材料压力建议；你可以在对应范围内调整材料目标，这不会被当作当前掌握程度的事实。</p>
          <div class="settings-options">
            <label class="settings-radio">
              <input type="radio" name="readingMode" value="support" ${currentMode === 'support' ? 'checked' : ''} onchange="SettingsView.onReadingModeChange()">
              <span class="settings-radio-label"><span class="settings-radio-title">巩固</span><span class="settings-radio-desc">材料目标 97–98%，优先保持流畅理解和巩固</span></span>
            </label>
            <label class="settings-radio">
              <input type="radio" name="readingMode" value="standard" ${currentMode === 'standard' ? 'checked' : ''} onchange="SettingsView.onReadingModeChange()">
              <span class="settings-radio-label"><span class="settings-radio-title">对标</span><span class="settings-radio-desc">材料目标 95–97%，用于目标考试导向练习</span></span>
            </label>
            <label class="settings-radio">
              <input type="radio" name="readingMode" value="stretch" ${currentMode === 'stretch' ? 'checked' : ''} onchange="SettingsView.onReadingModeChange()">
              <span class="settings-radio-label"><span class="settings-radio-title">加压</span><span class="settings-radio-desc">材料目标 92–95%，保留明确的理解压力</span></span>
            </label>
          </div>
          <div class="coverage-control">
            <div class="coverage-item">
              <label for="coverageSlider">材料目标覆盖率</label>
              <div class="slider-container">
                <input type="range" id="coverageSlider" min="${coveragePreference.range.min}" max="${coveragePreference.range.max}" value="${coveragePreference.coverage}"
                  oninput="SettingsView.updateCoverageLabel(this.value)">
                <div class="slider-labels">
                  <span id="coverageMin">${coveragePreference.range.min}%</span>
                  <span id="coverageDisplay" class="slider-current">${coveragePreference.coverage}%</span>
                  <span id="coverageMax">${coveragePreference.range.max}%</span>
                </div>
              </div>
              <p id="coverageHint" class="coverage-hint">用于设定生成材料的词汇压力和陌生词配比，不表示你当前已掌握词汇的实际覆盖；系统只在独立证据足够后另行给出匹配判断。</p>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h2 class="settings-section-title">离线词库与难度来源</h2>
          <p class="settings-desc">核心词库、版本、来源、许可证和校验和随 APK 安装；个人学习证据、收藏和复习记录保存在本机 IndexedDB，与公共词库分离。</p>
          <details class="settings-data-disclosure">
            <summary>查看当前数据与边界</summary>
            <div class="settings-data-disclosure-body">
              <p><strong>通用与学术词层：</strong>NGSL 用于通用高频层，NAWL 用于学术词层，CEFR-J 仅作为 CEFR 参考层。</p>
              <p><strong>释义质量：</strong>只有经过来源、词性和常用中文学习义审核的词可离线直接显示；受限词可按需读取 Open English WordNet 的英文义项结构，中文仍走在线词典或 AI 临时回退。</p>
              <p><strong>目标考试：</strong>四级、六级、英语一和英语二用于设定练习方向；不使用未授权历年题干或“真题词表”。在取得可复现且获许可的同口径语料前，App 不把生成材料表述为真题等值。</p>
              <p class="text-muted">完整的版本、来源、许可证、署名和 SHA-256 校验和随安装包中的 <code>data/lexicon-manifest.json</code>、<code>data/oewn-artifact-manifest.json</code> 与 <code>data/lexicon-ATTRIBUTION.md</code> 一同发布。</p>
            </div>
          </details>
        </div>

        <div class="settings-section">
          <h2 class="settings-section-title">外观</h2>
          <div class="settings-options">
            <label class="settings-radio">
              <input type="radio" name="theme" value="light" ${currentTheme === 'light' ? 'checked' : ''}>
              <span class="settings-radio-label">
                <span class="settings-radio-title">亮色模式</span>
              </span>
            </label>
            <label class="settings-radio">
              <input type="radio" name="theme" value="dark" ${currentTheme === 'dark' ? 'checked' : ''}>
              <span class="settings-radio-label">
                <span class="settings-radio-title">暗黑模式</span>
              </span>
            </label>
          </div>
        </div>

        <div class="settings-section">
          <h2 class="settings-section-title">API 设置</h2>
          <div class="form-group">
            <label>API Key</label>
            <input type="password" id="settingsApiKey" value="${esc(Config.get('api_key'))}" placeholder="sk-...">
          </div>
          <div class="form-group">
            <label>Base URL</label>
            <input type="text" id="settingsBaseUrl" value="${esc(Config.get('base_url'))}" placeholder="https://api.deepseek.com/v1">
          </div>
          <div class="form-group">
            <label>模型</label>
            <div class="model-select">
              <select id="settingsModelPreset" onchange="SettingsView.onModelChange()">
                <option value="deepseek-v4-flash" ${Config.get('model') === 'deepseek-v4-flash' ? 'selected' : ''}>DeepSeek V4 Flash（快速）</option>
                <option value="deepseek-v4-pro" ${Config.get('model') === 'deepseek-v4-pro' ? 'selected' : ''}>DeepSeek V4 Pro（高质量）</option>
                <option value="custom" ${!['deepseek-v4-flash', 'deepseek-v4-pro'].includes(Config.get('model')) ? 'selected' : ''}>自定义模型</option>
              </select>
              <input type="text" id="settingsModelInput" value="${!['deepseek-v4-flash', 'deepseek-v4-pro', ''].includes(Config.get('model')) ? esc(Config.get('model')) : ''}" placeholder="输入模型名称" style="display:${!['deepseek-v4-flash', 'deepseek-v4-pro', ''].includes(Config.get('model')) ? 'block' : 'none'}">
            </div>
          </div>
          <div class="api-tutorial">
            <div class="api-tutorial-toggle" onclick="this.parentElement.classList.toggle('open')">
              📖 如何获取 API Key？<span class="api-tutorial-arrow">▼</span>
            </div>
            <div class="api-tutorial-content">
              <div class="api-tutorial-step">
                <strong>1. 注册 DeepSeek 账号</strong>
                <p>访问 <a href="https://platform.deepseek.com" target="_blank">platform.deepseek.com</a>，注册并登录</p>
              </div>
              <div class="api-tutorial-step">
                <strong>2. 充值余额</strong>
                <p>进入「费用」页面，充值少量金额（几块钱即可，Flash 模型很便宜）</p>
              </div>
              <div class="api-tutorial-step">
                <strong>3. 创建 API Key</strong>
                <p>进入「API Keys」页面，点击「创建 API Key」，复制生成的密钥</p>
              </div>
              <div class="api-tutorial-step">
                <strong>4. 粘贴到上方</strong>
                <p>将复制的 Key 粘贴到上方「API Key」输入框，点击保存即可</p>
              </div>
              <div class="api-tutorial-note">
                💡 DeepSeek V4 Flash 每篇文章不到 ¥0.01，非常便宜。<br>
                也支持其他兼容 OpenAI 协议的服务（如 OpenRouter、硅基流动等），修改 Base URL 和模型名称即可。
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h2 class="settings-section-title">联网检索</h2>
          <p class="settings-desc">首页 Agent 查询最新资讯或感兴趣的话题时使用联网检索；DeepSeek 原生联网无需额外 Key，Tavily 为可选方案。</p>
          <div class="form-group">
            <label for="settingsWebResearchMode">联网检索方式</label>
            <select id="settingsWebResearchMode" onchange="SettingsView.onWebResearchModeChange()">
              <option value="deepseek_native" ${Config.get('web_research_mode') === 'deepseek_native' ? 'selected' : ''}>DeepSeek 原生联网（推荐，无需额外 Key）</option>
              <option value="tavily" ${Config.get('web_research_mode') === 'tavily' ? 'selected' : ''}>Tavily 联网检索（需要 Tavily Key）</option>
              <option value="off" ${Config.get('web_research_mode') === 'off' ? 'selected' : ''}>关闭联网检索</option>
            </select>
            <p id="webResearchModeStatus" class="settings-form-status" role="status"></p>
          </div>
          <button type="button" class="btn btn-outline btn-sm" id="settingsNativeTestBtn" onclick="SettingsView.testDeepSeekNativeConnection()">测试 DeepSeek 原生联网</button>
          <p id="deepSeekNativeStatus" class="settings-form-status" role="status"></p>
          <div class="api-tutorial">
            <div class="api-tutorial-toggle" onclick="this.parentElement.classList.toggle('open')">
              📖 DeepSeek 原生联网说明<span class="api-tutorial-arrow">▼</span>
            </div>
            <div class="api-tutorial-content">
              <div class="api-tutorial-step">
                <strong>使用条件</strong>
                <p>模型必须为 deepseek-v4-flash 且 Base URL 为 DeepSeek 官方地址；v4-pro 暂不支持原生联网。</p>
              </div>
              <div class="api-tutorial-step">
                <strong>工作原理</strong>
                <p>首页对话走 DeepSeek Responses API，由服务端自动执行联网搜索并返回真实来源，使用你现有的 DeepSeek Key，不需要额外注册。</p>
              </div>
              <div class="api-tutorial-note">
                💡 选择 Tavily 方式时需要在下方填写 Tavily Key；两种方式切换后立即生效，随时可以换回。
              </div>
            </div>
          </div>
          <div class="tavily-fields" id="tavilyFields">
          <div class="form-group">
            <label for="settingsTavilyKey">Tavily API Key</label>
            <div class="tavily-key-row">
              <input type="password" id="settingsTavilyKey" value="${esc(Config.get('tavily_api_key'))}" placeholder="tvly-..." autocomplete="off">
              <button type="button" class="btn btn-outline btn-sm" id="tavilyKeyToggle" onclick="SettingsView.toggleTavilyKeyVisibility()">显示</button>
            </div>
            <p id="tavilyConnectionStatus" class="settings-form-status" role="status"></p>
          </div>
          <button type="button" class="btn btn-outline btn-sm" onclick="SettingsView.testTavilyConnection()">测试连接</button>
          <div class="api-tutorial">
            <div class="api-tutorial-toggle" onclick="this.parentElement.classList.toggle('open')">
              📖 如何获取 Tavily API Key？<span class="api-tutorial-arrow">▼</span>
            </div>
            <div class="api-tutorial-content">
              <div class="api-tutorial-step">
                <strong>1. 注册 Tavily</strong>
                <p>访问 <a href="https://tavily.com" target="_blank" rel="noopener">tavily.com</a>，注册并登录</p>
              </div>
              <div class="api-tutorial-step">
                <strong>2. 创建 API Key</strong>
                <p>进入 API Keys 页面，点击「Create API Key」，复制以 tvly- 开头的密钥</p>
              </div>
              <div class="api-tutorial-step">
                <strong>3. 粘贴并测试</strong>
                <p>把密钥粘贴到上方，点击「测试连接」，确认可用后点「保存设置」</p>
              </div>
              <div class="api-tutorial-note">
                💡 Tavily 只用于联网检索，会产生 Tavily 服务用量，免费额度与价格以 Tavily 官网为准。Key 仅保存在本机安全存储，不会写入文章或对话记录。
              </div>
            </div>
          </div>
        </div>
        </div>

        <div class="settings-section">
          <h2 class="settings-section-title">🗂 标题翻译缓存</h2>
          <p class="settings-desc">阅读列表的中文标题会保存在本机；最多保留 300 条。</p>
          <div id="titleTranslationCacheInfo" class="audio-cache-info">加载中...</div>
          <button class="btn btn-outline btn-sm" onclick="SettingsView.clearTitleTranslationCache()" style="margin-top:8px">清除缓存</button>
        </div>

        <div class="settings-section">
          <h2 class="settings-section-title">🔊 发音缓存</h2>
          <p class="settings-desc">文章生成后自动缓存单词发音，离线也能播放</p>
          <div id="audioCacheInfo" class="audio-cache-info">加载中...</div>
          <button class="btn btn-outline btn-sm" onclick="SettingsView.clearAudioCache()" style="margin-top:8px">清除缓存</button>
        </div>

        <div class="settings-actions">
          <button class="btn btn-primary" onclick="SettingsView.save()">保存设置</button>
          <a href="#/chat" class="btn btn-outline">返回对话</a>
        </div>
      </section>`;

    document.querySelectorAll('input[name="theme"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        Theme.apply(e.target.value);
      });
    });

    const findInContainer = selector => typeof container.querySelector === 'function' ? container.querySelector(selector) : null;
    const examWordLookupToggle = findInContainer('#settingsExamWordLookup');
    examWordLookupToggle?.addEventListener('change', event => {
      const enabled = Boolean(event.target.checked);
      event.target.setAttribute('aria-checked', String(enabled));
      const state = findInContainer('#settingsExamWordLookupState');
      if (state) state.textContent = enabled ? '开' : '关';
      void Config.set('exam_word_lookup_enabled', String(enabled));
    });

    // Load cache info
    this.loadTitleTranslationCacheInfo();
    this.loadAudioCacheInfo();
    this.onWebResearchModeChange();
  },

  // Handle model preset change
  onModelChange() {
    const preset = document.getElementById('settingsModelPreset').value;
    document.getElementById('settingsModelInput').style.display = preset === 'custom' ? 'block' : 'none';
  },

  // Update the web research mode hint and toggle the Tavily-only fields.
  onWebResearchModeChange() {
    const select = document.getElementById('settingsWebResearchMode');
    if (!select) return;
    const mode = select.value;
    const status = document.getElementById('webResearchModeStatus');
    const tavilyFields = document.getElementById('tavilyFields');
    const nativeBtn = document.getElementById('settingsNativeTestBtn');
    const preset = document.getElementById('settingsModelPreset')?.value;
    const model = preset === 'custom'
      ? (document.getElementById('settingsModelInput')?.value.trim() || '')
      : (preset || Config.get('model'));
    const baseUrl = document.getElementById('settingsBaseUrl')?.value.trim() || Config.get('base_url');
    const nativeSupported = isDeepSeekNativeSearchSupported({ model, baseUrl });
    if (status) {
      if (mode === 'deepseek_native') {
        status.textContent = nativeSupported
          ? '当前模型与 Base URL 满足原生联网条件，无需额外 Key。'
          : '当前模型或 Base URL 不满足原生联网条件（需要 deepseek-v4-flash + DeepSeek 官方地址）；若配置了 Tavily Key 会自动回退。';
        status.className = 'settings-form-status' + (nativeSupported ? ' is-success' : ' is-error');
      } else if (mode === 'tavily') {
        status.textContent = 'Tavily 方式需要下方 Tavily Key；未填 Key 时首页不会联网。';
        status.className = 'settings-form-status';
      } else {
        status.textContent = '已关闭联网检索，首页 Agent 不会调用搜索工具。';
        status.className = 'settings-form-status';
      }
    }
    if (tavilyFields) tavilyFields.style.display = mode === 'tavily' ? '' : 'none';
    if (nativeBtn) nativeBtn.style.display = mode === 'deepseek_native' ? '' : 'none';
  },

  async testDeepSeekNativeConnection() {
    const status = document.getElementById('deepSeekNativeStatus');
    if (!status) return;
    const tempConfig = {
      get: key => {
        if (key === 'api_key') return document.getElementById('settingsApiKey')?.value.trim() || '';
        if (key === 'model') {
          const preset = document.getElementById('settingsModelPreset')?.value;
          return preset === 'custom'
            ? (document.getElementById('settingsModelInput')?.value.trim() || '')
            : (preset || Config.get('model'));
        }
        if (key === 'base_url') return document.getElementById('settingsBaseUrl')?.value.trim() || Config.get('base_url');
        return '';
      }
    };
    const client = createDeepSeekResponsesClient({ config: tempConfig });
    status.textContent = '正在测试 DeepSeek 原生联网…';
    status.className = 'settings-form-status';
    const result = await client.test();
    if (result.ok) {
      status.textContent = result.searched
        ? '✓ 原生联网正常，已执行真实搜索并返回回答'
        : 'API 连通，但本次未检测到实际搜索结果，联网功能可能暂不可用';
      status.className = 'settings-form-status ' + (result.searched ? 'is-success' : 'is-error');
    } else {
      status.textContent = '连接失败：' + (result.reason || '未知错误');
      status.className = 'settings-form-status is-error';
    }
  },

  updateCoverageLabel(value) {
    const coverage = document.getElementById('coverageDisplay');
    if (coverage) coverage.textContent = `${value}%`;
  },

  onReadingModeChange() {
    const mode = document.querySelector('input[name="readingMode"]:checked')?.value || 'standard';
    const preference = normalizeCoveragePreference(mode, document.getElementById('coverageSlider')?.value);
    const slider = document.getElementById('coverageSlider');
    if (slider) {
      slider.min = String(preference.range.min);
      slider.max = String(preference.range.max);
      slider.value = String(preference.coverage);
    }
    const min = document.getElementById('coverageMin');
    const max = document.getElementById('coverageMax');
    if (min) min.textContent = `${preference.range.min}%`;
    if (max) max.textContent = `${preference.range.max}%`;
    this.updateCoverageLabel(preference.coverage);
  },

  toggleTavilyKeyVisibility() {
    const input = document.getElementById('settingsTavilyKey');
    const toggle = document.getElementById('tavilyKeyToggle');
    if (!input || !toggle) return;
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    toggle.textContent = visible ? '显示' : '隐藏';
  },

  async testTavilyConnection() {
    const status = document.getElementById('tavilyConnectionStatus');
    if (!status) return;
    const inputValue = document.getElementById('settingsTavilyKey')?.value.trim() || '';
    const service = createWebResearch({
      config: { get: key => (key === 'tavily_api_key' ? inputValue : '') }
    });
    status.textContent = '正在测试连接…';
    status.className = 'settings-form-status';
    const result = await service.testConnection();
    if (result.ok) {
      status.textContent = '✓ 连接正常，Tavily 可访问';
      status.className = 'settings-form-status is-success';
    } else {
      status.textContent = result.reason === 'missing_key'
        ? '请先输入 Tavily API Key'
        : '连接失败，请检查 Key 与网络后重试';
      status.className = 'settings-form-status is-error';
    }
  },
  // Save all settings
  save() {
    const apiKey = document.getElementById('settingsApiKey').value.trim();
    if (!apiKey) {
      alert('请输入 API Key');
      return;
    }

    const preset = document.getElementById('settingsModelPreset').value;
    const model = preset === 'custom'
      ? document.getElementById('settingsModelInput').value.trim()
      : preset;

    Config.set('api_key', apiKey);
    Config.set('base_url', document.getElementById('settingsBaseUrl').value.trim() || 'https://api.deepseek.com/v1');
    Config.set('model', model || 'deepseek-v4-flash');
    Config.set('tavily_api_key', document.getElementById('settingsTavilyKey').value.trim());
    Config.set('web_research_mode', document.getElementById('settingsWebResearchMode')?.value || 'deepseek_native');

    const targetTrack = document.querySelector('input[name="targetTrack"]:checked')?.value;
    if (!normalizeSelectableTrack(targetTrack)) {
      alert('请先选择四级、六级、考研英语一或考研英语二作为后续阅读目标。');
      return;
    }
    const mode = document.querySelector('input[name="readingMode"]:checked')?.value || 'standard';
    const preference = normalizeCoveragePreference(mode, document.getElementById('coverageSlider')?.value);
    Config.set('exam_level', targetTrack);
    Config.set('target_track_selection_required', 'false');
    Config.set('reading_mode', preference.challenge);
    // Retain the legacy key only for older call sites until their migration.
    Config.set('level', preference.challenge === 'support' ? 'easy' : preference.challenge === 'stretch' ? 'hard' : 'normal');
    Config.set('coverage', String(preference.coverage));
    Config.set('new_word_percent', String(100 - preference.coverage));

    alert('设置已保存');
  },

  // Load title translation cache info
  loadTitleTranslationCacheInfo() {
    const el = document.getElementById('titleTranslationCacheInfo');
    if (!el) return;
    try {
      const entries = JSON.parse(localStorage.getItem('readingListTranslations') || '{}');
      el.innerHTML = `已缓存 <strong>${Object.keys(entries).length}</strong> 条标题翻译`;
    } catch {
      el.textContent = '缓存数据异常';
    }
  },

  // Clear title translation cache
  clearTitleTranslationCache() {
    if (!confirm('确定要清除所有标题翻译缓存吗？')) return;
    localStorage.removeItem('readingListTranslations');
    this.loadTitleTranslationCacheInfo();
    alert('标题翻译缓存已清除');
  },

  // Load audio cache info
  async loadAudioCacheInfo() {
    const el = document.getElementById('audioCacheInfo');
    if (!el) return;
    try {
      const info = await AudioCache.getCacheSize();
      el.innerHTML = `已缓存 <strong>${info.count}</strong> 个单词发音（约 ${info.estimatedMB} MB）`;
    } catch {
      el.textContent = '无法获取缓存信息';
    }
  },

  // Clear audio cache
  async clearAudioCache() {
    if (!confirm('确定要清除所有发音缓存吗？')) return;
    const success = await AudioCache.clearCache();
    if (success) {
      this.loadAudioCacheInfo();
      alert('缓存已清除');
    } else {
      alert('清除失败');
    }
  }
};

window.SettingsView = SettingsView;
