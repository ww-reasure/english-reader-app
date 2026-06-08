import { Config } from "./config.js";
/**
 * Theme Module
 * Handles dark/light mode switching
 */

export const Theme = {
  // Initialize theme from saved preference or system preference
  init() {
    const saved = Config.get('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    this.apply(theme);
  },

  // Apply theme to document
  apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    Config.set('theme', theme);
    this.updateToggle();
  },

  // Toggle between light and dark
  toggle() {
    const current = document.documentElement.getAttribute('data-theme');
    this.apply(current === 'dark' ? 'light' : 'dark');
  },

  // Update toggle button icon
  updateToggle() {
    const btn = document.getElementById('themeToggle');
    if (btn) {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      btn.textContent = isDark ? '☀️' : '🌙';
      btn.title = isDark ? '切换亮色模式' : '切换暗色模式';
    }
  }
};
