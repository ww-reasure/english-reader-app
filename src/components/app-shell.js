const routes = [
  ['#/chat', 'chat', '学习对话'],
  ['#/history', 'history', '阅读记录'],
  ['#/vocab', 'vocab', '词汇学习'],
  ['#/reading-list', 'reading-list', '我的书架'],
  ['#/profile', 'profile', '学习档案']
];

export const AppShell = {
  _onKeydown: null,
  _onRouteIntent: null,
  _onMediaChange: null,
  _mediaQuery: null,
  _setDrawerOpen: null,
  _container: null,
  _shell: null,
  _activeOutlet: null,
  _outlets: new Map(),
  _outletSequence: 0,
  _currentMeta: null,
  _routeIntentHandler: null,

  getRouteMeta(hash) {
    if (hash.startsWith('#/reading/')) return { navKey: 'reading-list', title: '阅读', headerMode: 'back', backFallback: '#/reading-list', tabletLayout: 'focus' };
    if (hash === '#/vocab' || hash.startsWith('#/flashcard')) {
      return { navKey: 'vocab', title: hash.startsWith('#/flashcard') ? '单词复习' : '词汇学习', ...(hash.startsWith('#/flashcard') ? { headerMode: 'back', backFallback: '#/vocab' } : {}), tabletLayout: hash.startsWith('#/flashcard') ? 'focus' : 'rail' };
    }
    if (hash === '#/settings') return { navKey: 'profile', title: '设置', headerMode: 'back', backFallback: '#/chat', tabletLayout: 'focus' };
    if (hash === '#/assessment' || hash === '#/report' || hash === '#/stats') {
      return {
        navKey: 'profile',
        title: hash === '#/assessment' ? '水平测评' : hash === '#/report' ? '学习报告' : '学习档案',
        tabletLayout: 'rail'
      };
    }
    const match = routes.find(item => item[0] === hash) || routes[0];
    return { navKey: match[1], title: match[2], tabletLayout: 'rail' };
  },

  getHeaderActions(navKey, hash = '') {
    const readingMatch = String(hash).match(/^#\/reading\/(\d+)$/);
    if (navKey === 'reading-list' && readingMatch) {
      const articleId = readingMatch[1];
      return `<div class="app-header-actions reading-app-header-actions" aria-label="阅读操作">
        <button id="favBtn" class="app-icon-button reading-favorite-btn" type="button" onclick="ReadingView.toggleFavorite(${articleId})" aria-pressed="false" aria-label="收藏文章" title="收藏文章"><i class="fa-regular fa-star" aria-hidden="true"></i></button>
        <button id="readingMoreBtn" class="app-icon-button reading-more-btn" type="button" onclick="ReadingView.toggleReadingActions()" aria-expanded="false" aria-controls="readingActionsOverlay" aria-label="打开阅读工具" title="打开阅读工具">⋯</button>
      </div>`;
    }
    if (navKey !== 'chat') return '<div class="app-header-actions" aria-hidden="true"></div>';
    return `<div class="app-header-actions">
      <button id="appClearContextBtn" class="app-icon-button" type="button" aria-label="清除对话上下文" title="清除对话上下文"><i class="fa-solid fa-broom" aria-hidden="true"></i></button>
      <a class="app-icon-button" href="#/settings" aria-label="打开设置" title="打开设置"><i class="fa-solid fa-gear" aria-hidden="true"></i></a>
    </div>`;
  },

  _ensureMounted(container) {
    if (this._shell && this._container === container) return;
    this.cleanup();
    this._container = container;
    const links = routes.map(([href, navKey, label]) => (
      '<a href="' + href + '" data-route-intent="' + href + '">' + label + '</a>'
    )).join('');
    container.innerHTML = `
      <div class="app-shell app-shell--standard app-shell--rail">
        <header class="app-header">
          <button id="appMenuBtn" class="app-icon-button app-menu-button" type="button" aria-label="打开导航" aria-controls="appDrawer" aria-expanded="false"><i class="fa-solid fa-bars" aria-hidden="true"></i></button>
          <div class="app-header-copy"><p class="app-header-kicker"></p><h1 class="app-header-title"></h1></div>
          <div class="app-header-actions" aria-hidden="true"></div>
        </header>
        <button id="appDrawerBackdrop" class="app-drawer-backdrop" type="button" aria-label="关闭导航"></button>
        <aside id="appDrawer" class="app-drawer" aria-label="主要导航" aria-hidden="true">
          <div class="app-drawer-top"><p class="app-drawer-brand">LEARNING NOTEBOOK</p><button id="appDrawerClose" class="app-drawer-close" type="button" aria-label="关闭导航"><i class="fa-solid fa-xmark" aria-hidden="true"></i><span class="sr-only">关闭导航</span></button></div>
          <nav aria-label="主要导航">${links}</nav>
        </aside>
      </div>`;
    this._shell = container.querySelector('.app-shell');
    const drawer = document.getElementById('appDrawer');
    const backdrop = document.getElementById('appDrawerBackdrop');
    const menu = document.getElementById('appMenuBtn');
    const close = document.getElementById('appDrawerClose');
    const mediaQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 600px)')
      : null;
    this._mediaQuery = mediaQuery;
    const isPersistent = () => this._currentMeta?.tabletLayout === 'rail' && (mediaQuery ? mediaQuery.matches : (typeof window !== 'undefined' && window.innerWidth >= 600));
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

    menu.addEventListener('click', () => {
      const currentMeta = this._currentMeta || {};
      if ((currentMeta.headerMode || 'drawer') === 'back') {
        window.Router?.back?.(currentMeta.backFallback);
        return;
      }
      setOpen(!drawer.classList.contains('is-open'));
    });
    close.addEventListener('click', () => setOpen(false));
    backdrop.addEventListener('click', () => setOpen(false));
    this._onKeydown = event => {
      if (event.key === 'Escape' && drawer.classList.contains('is-open')) setOpen(false);
    };
    document.addEventListener('keydown', this._onKeydown);
    this._onRouteIntent = event => {
      const link = event.target?.closest?.('a[href^="#/"]');
      if (!link) return;
      this._routeIntentHandler?.(link.getAttribute('href'));
    };
    this._shell.addEventListener('pointerdown', this._onRouteIntent, true);
    this._shell.addEventListener('focusin', this._onRouteIntent, true);
  },

  _updateShell(meta, pageMode, hash) {
    this._currentMeta = meta;
    document.body.classList.add('app-shell-active');
    document.body.dataset.pageMode = pageMode;
    const shell = this._shell;
    const isVocabularyHome = meta.navKey === 'vocab' && hash === '#/vocab';
    const isSettings = hash === '#/settings';
    const headerMode = meta.headerMode || 'drawer';
    shell.className = `app-shell app-shell--${pageMode} app-shell--${meta.tabletLayout || 'rail'} app-shell--${headerMode === 'back' ? 'back' : 'root'}${isVocabularyHome ? ' app-shell--vocab' : ''}${isSettings ? ' app-shell--settings' : ''}`;
    shell.querySelector('.app-header-kicker').textContent = meta.navKey === 'chat' ? 'AI STUDY COACH' : 'ENGLISH LEARNING';
    shell.querySelector('.app-header-title').textContent = meta.title;
    const oldActions = shell.querySelector('.app-header-actions');
    oldActions.outerHTML = this.getHeaderActions(meta.navKey, hash);
    shell.querySelectorAll('.app-drawer a').forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === routes.find(([, navKey]) => navKey === meta.navKey)?.[0]);
    });
    const menu = shell.querySelector('#appMenuBtn');
    menu.classList.toggle('app-menu-button', headerMode !== 'back');
    menu.innerHTML = headerMode === 'back'
      ? '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
    menu.setAttribute('aria-label', headerMode === 'back' ? `返回${isSettings ? '学习对话' : meta.navKey === 'reading-list' ? '书架' : meta.navKey === 'vocab' ? '词汇学习' : '真题训练'}` : '打开导航');
    if (headerMode === 'back') {
      menu.removeAttribute('aria-controls');
      menu.removeAttribute('aria-expanded');
    } else {
      menu.setAttribute('aria-controls', 'appDrawer');
      menu.setAttribute('aria-expanded', 'false');
    }
    this._setDrawerOpen?.(false, { focusMenu: false });
  },

  mount(container, meta, pageMode, hash = '', { routeKey = hash || 'route', cachePolicy = 'dispose', reuse = false } = {}) {
    this._ensureMounted(container);
    this._updateShell(meta, pageMode, hash);
    let outlet = cachePolicy === 'keep-alive' ? this._outlets.get(routeKey) : null;
    if (!outlet) {
      outlet = document.createElement('main');
      outlet.className = 'app-page-outlet app-route-layer';
      outlet.tabIndex = -1;
      outlet.dataset.routeKey = routeKey;
      outlet.dataset.cachePolicy = cachePolicy;
      const storageKey = cachePolicy === 'keep-alive' ? routeKey : `${routeKey}:${++this._outletSequence}`;
      outlet.dataset.routeStorageKey = storageKey;
      this._outlets.set(storageKey, outlet);
      this._shell.insertBefore(outlet, this._activeOutlet || null);
    }
    outlet.dataset.routeReuse = String(Boolean(reuse));
    outlet.hidden = false;
    outlet.classList.toggle('is-route-staging', Boolean(this._activeOutlet && this._activeOutlet !== outlet));
    outlet.toggleAttribute('inert', Boolean(this._activeOutlet && this._activeOutlet !== outlet));
    outlet.setAttribute('aria-hidden', String(Boolean(this._activeOutlet && this._activeOutlet !== outlet)));
    if (!this._activeOutlet) this.commitRoute(outlet, { routeKey, cachePolicy });
    else {
      this._activeOutlet.removeAttribute('id');
      outlet.id = 'pageOutlet';
    }
    return outlet;
  },

  commitRoute(outlet) {
    if (!outlet) return;
    const previous = this._activeOutlet;
    if (previous && previous !== outlet) previous.dataset.savedScrollTop = String(previous.scrollTop || 0);
    for (const candidate of this._outlets.values()) {
      const active = candidate === outlet;
      candidate.hidden = !active;
      candidate.classList.toggle('is-route-active', active);
      candidate.classList.remove('is-route-staging');
      candidate.toggleAttribute('inert', !active);
      candidate.setAttribute('aria-hidden', String(!active));
      candidate.style.contentVisibility = active ? 'visible' : 'hidden';
      candidate.removeAttribute('id');
    }
    outlet.id = 'pageOutlet';
    this._activeOutlet = outlet;
    const restoreTop = Number(outlet.dataset.savedScrollTop || 0);
    if (Number.isFinite(restoreTop)) outlet.scrollTop = restoreTop;
  },

  abortRoute(outlet) {
    if (!outlet || outlet === this._activeOutlet) return;
    if (outlet.dataset.routeReuse === 'true') {
      outlet.hidden = true;
      outlet.classList.remove('is-route-staging');
      outlet.toggleAttribute('inert', true);
      outlet.setAttribute('aria-hidden', 'true');
    } else {
      this.releaseRoute(outlet.dataset.routeKey, outlet);
    }
    if (this._activeOutlet) this._activeOutlet.id = 'pageOutlet';
  },

  releaseRoute(_routeKey, outlet) {
    if (!outlet || outlet === this._activeOutlet) return;
    for (const [key, candidate] of this._outlets.entries()) {
      if (candidate !== outlet) continue;
      this._outlets.delete(key);
      break;
    }
    outlet.remove?.();
  },

  setRouteIntentHandler(handler) {
    this._routeIntentHandler = typeof handler === 'function' ? handler : null;
  },

  cleanup() {
    if (this._onKeydown) document.removeEventListener('keydown', this._onKeydown);
    if (this._mediaQuery?.removeEventListener) this._mediaQuery.removeEventListener('change', this._onMediaChange);
    else this._mediaQuery?.removeListener?.(this._onMediaChange);
    this._shell?.removeEventListener?.('pointerdown', this._onRouteIntent, true);
    this._shell?.removeEventListener?.('focusin', this._onRouteIntent, true);
    this._onKeydown = null;
    this._onMediaChange = null;
    this._mediaQuery = null;
    this._setDrawerOpen = null;
    this._onRouteIntent = null;
    this._currentMeta = null;
    this._activeOutlet = null;
    this._outlets.clear();
    this._shell = null;
    this._container = null;
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
