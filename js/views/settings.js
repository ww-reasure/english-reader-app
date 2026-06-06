/**
 * Settings View
 * Manages app settings: difficulty level, API configuration
 */

const SettingsView = {
  // Render settings page
  render(container) {
    const currentLevel = Config.get('level') || 'easy';
    const currentTheme = Config.get('theme') || 'light';

    container.innerHTML = `
      <div class="settings-container">
        <h1 class="page-title">设置</h1>

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

    alert('设置已保存');
  }
};
