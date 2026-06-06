/**
 * Settings View
 * Manages app settings: difficulty level, API configuration
 */

const SettingsView = {
  // Render settings page
  render(container) {
    const currentLevel = Config.get('level') || 'easy';
    const currentTheme = Config.get('theme') || 'light';
    const currentCoverage = Config.get('coverage') || '95';
    const currentNewWordPercent = Config.get('new_word_percent') || '5';
    const assessmentDone = Config.get('assessment_done') === 'true';
    const assessmentVocab = Config.get('assessment_vocab') || '';
    const assessmentDate = Config.get('assessment_date') || '';

    container.innerHTML = `
      <div class="settings-container">
        <h1 class="page-title">设置</h1>

        ${assessmentDone ? `
        <div class="settings-section">
          <h2 class="settings-section-title">📊 测评结果</h2>
          <div class="assessment-result-card">
            <div class="assessment-result-info">
              <span>预估词汇量：<strong>${assessmentVocab} 词</strong></span>
              <span class="text-muted">${assessmentDate ? '测评时间：' + new Date(assessmentDate).toLocaleDateString('zh-CN') : ''}</span>
            </div>
            <button class="btn btn-outline btn-sm" onclick="location.hash='#/assessment'">重新测评</button>
          </div>
        </div>` : `
        <div class="settings-section">
          <h2 class="settings-section-title">📊 阅读水平测评</h2>
          <p class="settings-desc">通过阅读测试评估你的词汇量，系统会自动推荐最佳难度和生词比例</p>
          <button class="btn btn-primary" onclick="location.hash='#/assessment'">开始测评</button>
        </div>`}

        <div class="settings-section">
          <h2 class="settings-section-title">难度模式</h2>
          <p class="settings-desc">选择"易"或"难"，与对话界面的考试级别组合生效</p>
          <div class="settings-options">
            <label class="settings-radio">
              <input type="radio" name="level" value="easy" ${currentLevel === 'easy' ? 'checked' : ''}>
              <span class="settings-radio-label">
                <span class="settings-radio-title">易</span>
                <span class="settings-radio-desc">基础难度，适合入门和巩固</span>
              </span>
            </label>
            <label class="settings-radio">
              <input type="radio" name="level" value="hard" ${currentLevel === 'hard' ? 'checked' : ''}>
              <span class="settings-radio-label">
                <span class="settings-radio-title">难</span>
                <span class="settings-radio-desc">接近真题难度，适合冲刺备考</span>
              </span>
            </label>
          </div>
        </div>

        <div class="settings-section">
          <h2 class="settings-section-title">生词比例控制</h2>
          <p class="settings-desc">控制生成文章中已学词汇和新词的比例（基于 Nation 98% 覆盖率理论）</p>
          <div class="coverage-control">
            <div class="coverage-item">
              <label>词汇覆盖率</label>
              <div class="slider-container">
                <input type="range" id="coverageSlider" min="80" max="99" value="${currentCoverage}"
                  oninput="SettingsView.updateCoverageLabel(this.value)">
                <div class="slider-labels">
                  <span>80%</span>
                  <span id="coverageValue" class="slider-current">${currentCoverage}%</span>
                  <span>99%</span>
                </div>
              </div>
              <p class="coverage-hint">每100个词中你认识的比例。98% 为舒适阅读阈值（Nation 研究）</p>
            </div>
            <div class="coverage-item">
              <label>新词比例</label>
              <div class="slider-container">
                <input type="range" id="newWordSlider" min="1" max="20" value="${currentNewWordPercent}"
                  oninput="SettingsView.updateNewWordLabel(this.value)">
                <div class="slider-labels">
                  <span>1%</span>
                  <span id="newWordValue" class="slider-current">${currentNewWordPercent}%</span>
                  <span>20%</span>
                </div>
              </div>
              <p class="coverage-hint">文章中新词的占比。2-5% 适合舒适阅读，5-10% 适合有意挑战</p>
            </div>
            <div class="coverage-preset">
              <span class="text-muted">快速预设：</span>
              <button class="btn btn-outline btn-sm" onclick="SettingsView.setPreset(98,2)">轻松阅读</button>
              <button class="btn btn-outline btn-sm" onclick="SettingsView.setPreset(95,5)">正常学习</button>
              <button class="btn btn-outline btn-sm" onclick="SettingsView.setPreset(90,10)">挑战模式</button>
            </div>
          </div>
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
        </div>

        <div class="settings-actions">
          <button class="btn btn-primary" onclick="SettingsView.save()">保存设置</button>
          <a href="#/chat" class="btn btn-outline">返回对话</a>
        </div>
      </div>`;

    // Add event listeners for radio buttons (auto-save on change)
    document.querySelectorAll('input[name="level"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        Config.set('level', e.target.value);
      });
    });

    document.querySelectorAll('input[name="theme"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        Theme.apply(e.target.value);
      });
    });
  },

  // Handle model preset change
  onModelChange() {
    const preset = document.getElementById('settingsModelPreset').value;
    document.getElementById('settingsModelInput').style.display = preset === 'custom' ? 'block' : 'none';
  },

  // Update coverage slider label
  updateCoverageLabel(value) {
    const label = document.getElementById('coverageValue');
    if (label) label.textContent = value + '%';
  },

  // Update new word slider label
  updateNewWordLabel(value) {
    const label = document.getElementById('newWordValue');
    if (label) label.textContent = value + '%';
  },

  // Set preset values
  setPreset(coverage, newWord) {
    const coverageSlider = document.getElementById('coverageSlider');
    const newWordSlider = document.getElementById('newWordSlider');
    if (coverageSlider) {
      coverageSlider.value = coverage;
      this.updateCoverageLabel(coverage);
    }
    if (newWordSlider) {
      newWordSlider.value = newWord;
      this.updateNewWordLabel(newWord);
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

    // Save coverage settings
    const coverageSlider = document.getElementById('coverageSlider');
    const newWordSlider = document.getElementById('newWordSlider');
    if (coverageSlider) Config.set('coverage', coverageSlider.value);
    if (newWordSlider) Config.set('new_word_percent', newWordSlider.value);

    alert('设置已保存');
  }
};
