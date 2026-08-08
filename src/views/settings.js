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
  },

  // Handle model preset change
  onModelChange() {
    const preset = document.getElementById('settingsModelPreset').value;
    document.getElementById('settingsModelInput').style.display = preset === 'custom' ? 'block' : 'none';
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
