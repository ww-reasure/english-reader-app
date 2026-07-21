const routes = [
  ['#/chat', 'chat', '学习对话'],
  ['#/history', 'history', '阅读记录'],
  ['#/vocab', 'vocab', '词汇学习'],
  ['#/reading-list', 'reading-list', '我的书架'],
  ['#/profile', 'profile', '学习档案']
];

export const AppShell = {
  _onKeydown: null,

  getRouteMeta(hash) {
    if (hash.startsWith('#/reading/')) return { navKey: 'reading-list', title: '阅读' };
    if (hash === '#/learn-words' || hash === '#/flashcard') {
      return { navKey: 'vocab', title: hash === '#/flashcard' ? '单词复习' : '词汇学习' };
    }
    if (hash === '#/settings' || hash === '#/assessment' || hash === '#/report' || hash === '#/stats') {
      return {
        navKey: 'profile',
        title: hash === '#/assessment' ? '水平测评' : hash === '#/report' ? '学习报告' : hash === '#/settings' ? '设置' : '学习档案'
      };
    }
    const match = routes.find(item => item[0] === hash) || routes[0];
    return { navKey: match[1], title: match[2] };
  },

  mount(container, meta, pageMode) {
    this.cleanup();
    document.body.classList.add('app-shell-active');
    document.body.dataset.pageMode = pageMode;
    const links = routes.map(([href, navKey, label]) => (
      '<a class="' + (navKey === meta.navKey ? 'active' : '') + '" href="' + href + '">' + label + '</a>'
    )).join('');

    container.innerHTML = `
      <div class="app-shell app-shell--${pageMode}">
        <header class="app-header">
          <button id="appMenuBtn" class="app-icon-button" type="button" aria-label="打开导航" aria-expanded="false">☰</button>
          <h1 class="app-header-title">${meta.title}</h1>
          <a class="app-icon-button" href="#/settings" aria-label="打开设置">⚙</a>
        </header>
        <button id="appDrawerBackdrop" class="app-drawer-backdrop" type="button" aria-label="关闭导航"></button>
        <aside id="appDrawer" class="app-drawer" aria-label="主要导航" aria-hidden="true">
          <nav>${links}</nav>
        </aside>
        <main id="pageOutlet" class="app-page-outlet" tabindex="-1"></main>
      </div>`;

    const drawer = document.getElementById('appDrawer');
    const backdrop = document.getElementById('appDrawerBackdrop');
    const menu = document.getElementById('appMenuBtn');
    const setOpen = open => {
      drawer.classList.toggle('is-open', open);
      drawer.setAttribute('aria-hidden', String(!open));
      backdrop.classList.toggle('is-open', open);
      menu.setAttribute('aria-expanded', String(open));
      if (open) drawer.querySelector('a.active, a')?.focus();
      else menu.focus();
    };

    menu.addEventListener('click', () => setOpen(!drawer.classList.contains('is-open')));
    backdrop.addEventListener('click', () => setOpen(false));
    this._onKeydown = event => {
      if (event.key === 'Escape' && drawer.classList.contains('is-open')) setOpen(false);
    };
    document.addEventListener('keydown', this._onKeydown);
    return document.getElementById('pageOutlet');
  },

  cleanup() {
    if (this._onKeydown) document.removeEventListener('keydown', this._onKeydown);
    this._onKeydown = null;
    document.body.classList.remove('app-shell-active');
    delete document.body.dataset.pageMode;
  }
};
