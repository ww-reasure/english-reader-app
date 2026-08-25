const routes = [
  ['#/chat', 'chat', '学习对话'],
  ['#/history', 'history', '阅读记录'],
  ['#/vocab', 'vocab', '词汇学习'],
  ['#/reading-list', 'reading-list', '我的书架'],
  ['#/exam', 'exam', '真题训练'],
  ['#/profile', 'profile', '学习档案']
];

export const AppShell = {
  _onKeydown: null,
  _onMediaChange: null,
  _mediaQuery: null,
  _setDrawerOpen: null,

  getRouteMeta(hash) {
    if (hash === '#/exam') return { navKey: 'exam', title: '真题训练', headerMode: 'drawer', tabletLayout: 'rail' };
    if (hash === '#/exam/review') return { navKey: 'exam', title: '错题复习', headerMode: 'back', tabletLayout: 'rail' };
    if (hash === '#/exam/history') return { navKey: 'exam', title: '学习记录', headerMode: 'back', tabletLayout: 'rail' };
    if (hash.startsWith('#/exam/catalog/')) {
      const type = hash.match(/^#\/exam\/catalog\/([^/]+)/)?.[1];
      const titles = { full_paper: '整卷练习', cloze_choice: '完形填空', reading_mcq: '阅读理解', paragraph_ordering: '阅读新题型 Part B', part_b: '阅读新题型 Part B', translation: '翻译' };
      return { navKey: 'exam', title: titles[type] || '专项训练', headerMode: 'back', tabletLayout: 'rail' };
    }
    if (hash.startsWith('#/exam/practice/')) return { navKey: 'exam', title: '真题练习', headerMode: 'back', tabletLayout: 'focus' };
    if (hash.startsWith('#/exam/result/')) return { navKey: 'exam', title: '练习结果', headerMode: 'back', tabletLayout: 'focus' };
    if (hash.startsWith('#/reading/')) return { navKey: 'reading-list', title: '阅读', headerMode: 'back', tabletLayout: 'focus' };
    if (hash === '#/vocab' || hash.startsWith('#/flashcard')) {
      return { navKey: 'vocab', title: hash.startsWith('#/flashcard') ? '单词复习' : '词汇学习', ...(hash.startsWith('#/flashcard') ? { headerMode: 'back' } : {}), tabletLayout: hash.startsWith('#/flashcard') ? 'focus' : 'rail' };
    }
    if (hash === '#/settings' || hash === '#/assessment' || hash === '#/report' || hash === '#/stats') {
      return {
        navKey: 'profile',
        title: hash === '#/assessment' ? '水平测评' : hash === '#/report' ? '学习报告' : hash === '#/settings' ? '设置' : '学习档案',
        tabletLayout: 'rail'
      };
    }
    const match = routes.find(item => item[0] === hash) || routes[0];
    return { navKey: match[1], title: match[2], tabletLayout: 'rail' };
  },

  getHeaderActions(navKey) {
    if (navKey !== 'chat') return '<div class="app-header-actions" aria-hidden="true"></div>';
    return `<div class="app-header-actions">
      <button id="appClearContextBtn" class="app-icon-button" type="button" aria-label="清除对话上下文" title="清除对话上下文"><i class="fa-solid fa-broom" aria-hidden="true"></i></button>
      <a class="app-icon-button" href="#/settings" aria-label="打开设置" title="打开设置"><i class="fa-solid fa-gear" aria-hidden="true"></i></a>
    </div>`;
  },

  mount(container, meta, pageMode, hash = '') {
    this.cleanup();
    document.body.classList.add('app-shell-active');
    document.body.dataset.pageMode = pageMode;
    const links = routes.map(([href, navKey, label]) => (
      '<a class="' + (navKey === meta.navKey ? 'active' : '') + '" href="' + href + '">' + label + '</a>'
    )).join('');

    const kicker = meta.navKey === 'chat' ? 'AI STUDY COACH' : 'ENGLISH LEARNING';
    const headerActions = this.getHeaderActions(meta.navKey);
    const headerMode = meta.headerMode || 'drawer';
    const hasDrawer = meta.tabletLayout === 'rail';
    const isVocabularyHome = meta.navKey === 'vocab' && hash === '#/vocab';
    const examShellVariant = hash === '#/exam' ? ' app-shell--exam-home' : hash.startsWith('#/exam/catalog/') ? ' app-shell--exam-catalog' : '';
    container.innerHTML = `
      <div class="app-shell app-shell--${pageMode} app-shell--${meta.tabletLayout || 'rail'}${isVocabularyHome ? ' app-shell--vocab' : ''}${meta.navKey === 'exam' ? ' app-shell--exam' : ''}${examShellVariant}">
        <header class="app-header">
          ${headerMode === 'back' ? `<button id="appMenuBtn" class="app-icon-button" type="button" aria-label="返回${meta.navKey === 'reading-list' ? '书架' : meta.navKey === 'vocab' ? '词汇学习' : '真题训练'}"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>` : '<button id="appMenuBtn" class="app-icon-button app-menu-button" type="button" aria-label="打开导航" aria-controls="appDrawer" aria-expanded="false"><i class="fa-solid fa-bars" aria-hidden="true"></i></button>'}
          <div class="app-header-copy"><p class="app-header-kicker">${kicker}</p><h1 class="app-header-title">${meta.title}</h1></div>
          ${isVocabularyHome ? '<p class="app-header-description">导入单词与阅读收藏单词一并呈现，统一学习与复习。</p>' : ''}
          ${headerActions}
        </header>
        ${hasDrawer ? '<button id="appDrawerBackdrop" class="app-drawer-backdrop" type="button" aria-label="关闭导航"></button>' : ''}
        ${hasDrawer ? `<aside id="appDrawer" class="app-drawer" aria-label="主要导航" aria-hidden="true">
          <div class="app-drawer-top"><p class="app-drawer-brand">LEARNING NOTEBOOK</p><button id="appDrawerClose" class="app-drawer-close" type="button" aria-label="关闭导航"><i class="fa-solid fa-xmark" aria-hidden="true"></i><span class="sr-only">关闭导航</span></button></div>
          <nav aria-label="主要导航">${links}</nav>
        </aside>` : ''}
        <main id="pageOutlet" class="app-page-outlet" tabindex="-1"></main>
      </div>`;

    const drawer = document.getElementById('appDrawer');
    const backdrop = document.getElementById('appDrawerBackdrop');
    const menu = document.getElementById('appMenuBtn');
    const close = document.getElementById('appDrawerClose');
    if (!hasDrawer) {
      menu.addEventListener('click', () => {
        if (headerMode === 'back') location.hash = meta.navKey === 'reading-list' ? '#/reading-list' : meta.navKey === 'vocab' ? '#/vocab' : '#/exam';
      });
      return document.getElementById('pageOutlet');
    }
    const mediaQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 600px)')
      : null;
    this._mediaQuery = mediaQuery;
    const isPersistent = () => meta.tabletLayout === 'rail' && (mediaQuery ? mediaQuery.matches : (typeof window !== 'undefined' && window.innerWidth >= 600));
    const setOpen = (open, { focusMenu = true } = {}) => {
      const persistent = isPersistent();
      if (persistent) open = false;
      drawer.classList.toggle('is-open', open);
      drawer.setAttribute('aria-hidden', String(persistent ? false : !open));
      backdrop.classList.toggle('is-open', open);
      menu.setAttribute('aria-expanded', String(!persistent && open));
      if (open) drawer.querySelector('a.active, a')?.focus();
      else if (!persistent && focusMenu) menu.focus();
    };
    this._setDrawerOpen = setOpen;
    this._onMediaChange = () => setOpen(false);
    if (mediaQuery?.addEventListener) mediaQuery.addEventListener('change', this._onMediaChange);
    else mediaQuery?.addListener?.(this._onMediaChange);
    setOpen(false, { focusMenu: false });

    menu.addEventListener('click', () => setOpen(!drawer.classList.contains('is-open')));
    close.addEventListener('click', () => setOpen(false));
    backdrop.addEventListener('click', () => setOpen(false));
    this._onKeydown = event => {
      if (event.key === 'Escape' && drawer.classList.contains('is-open')) setOpen(false);
    };
    document.addEventListener('keydown', this._onKeydown);
    return document.getElementById('pageOutlet');
  },

  cleanup() {
    if (this._onKeydown) document.removeEventListener('keydown', this._onKeydown);
    if (this._mediaQuery?.removeEventListener) this._mediaQuery.removeEventListener('change', this._onMediaChange);
    else this._mediaQuery?.removeListener?.(this._onMediaChange);
    this._onKeydown = null;
    this._onMediaChange = null;
    this._mediaQuery = null;
    this._setDrawerOpen = null;
    document.body.classList.remove('app-shell-active');
    delete document.body.dataset.pageMode;
  },
  closeDrawer() {
    const drawer = document.getElementById('appDrawer');
    if (!drawer?.classList.contains('is-open')) return false;
    this._setDrawerOpen?.(false);
    return true;
  }
};
