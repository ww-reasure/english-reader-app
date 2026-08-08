const EXAM_BOTTOM_NAV_ITEMS = Object.freeze([
  { id: 'exam', href: '#/exam', icon: 'fa-solid fa-book-open', label: '真题训练' },
  { id: 'review', href: '#/exam/review', icon: 'fa-regular fa-rectangle-list', label: '复习中心' },
  { id: 'history', href: '#/exam/history', icon: 'fa-solid fa-chart-simple', label: '学习记录' }
]);

export function renderExamBottomNav(activeTab = 'exam') {
  return `<nav class="exam-bottom-nav" aria-label="真题模块导航">${EXAM_BOTTOM_NAV_ITEMS.map(item => `
    <a class="${item.id === activeTab ? 'is-active' : ''}" href="${item.href}"${item.id === activeTab ? ' aria-current="page"' : ''}>
      <i class="${item.icon}" aria-hidden="true"></i><span>${item.label}</span>
    </a>`).join('')}
  </nav>`;
}
