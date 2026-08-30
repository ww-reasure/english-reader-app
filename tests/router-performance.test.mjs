import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('router keeps view modules out of the entry chunk and uses explicit dynamic route loaders', async () => {
  const [router, routes] = await Promise.all([
    read('../src/router.js'),
    read('../src/router-routes.mjs')
  ]);

  assert.doesNotMatch(router, /from ['"]\.\/views\//);
  assert.match(router, /createNavigationController/);
  for (const view of [
    'chat',
    'reading',
    'history',
    'vocabulary',
    'flashcard',
    'review-mode',
    'context-review',
    'settings',
    'stats',
    'report',
    'calibration',
    'reading-list',
  ]) {
    assert.match(routes, new RegExp(`import\\(['"]\\.\\/views\\/${view}\\.js['"]\\)`), `missing dynamic loader for ${view}`);
  }
});

test('route resolver preserves legacy hash precedence and decoded parameters', async () => {
  const { resolveRoute } = await import('../src/router-routes.mjs');

  assert.equal(resolveRoute('#/chat').routeKey, 'chat');
  assert.equal(resolveRoute('#/reading/42').routeKey, 'reading');
  assert.deepEqual(resolveRoute('#/reading/42').args, [42]);
  assert.equal(resolveRoute('#/flashcard').routeKey, 'review-mode');
  assert.equal(resolveRoute('#/flashcard/recall').routeKey, 'flashcard');
  assert.equal(resolveRoute('#/flashcard/practice/manual').routeKey, 'flashcard');
  assert.deepEqual(resolveRoute('#/flashcard/practice/manual').args, ['manual']);
  assert.equal(resolveRoute('#/profile').routeKey, 'profile');
  assert.equal(resolveRoute('#/unknown').routeKey, 'chat');
});

test('navigation prepares a stable outlet without tearing down the live page while the module loads', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  let releaseCleanup;
  const events = [];
  const outlet = { innerHTML: '' };
  const oldView = {
    cleanup() {
      events.push('cleanup-start');
      return new Promise(resolve => { releaseCleanup = resolve; });
    }
  };
  const controller = createNavigationController({
    initialView: oldView,
    appShell: {
      cleanup() { events.push('shell-cleanup'); },
      mount() { events.push('shell-mount'); return outlet; }
    },
    wordStudyDetail: { close() { events.push('detail-close'); } },
    getApp: () => ({ id: 'app' }),
    getRouteMeta: () => ({ title: '下一页' }),
    resolveRoute: () => ({
      routeKey: 'next',
      exportName: 'NextView',
      args: [],
      load: () => new Promise(() => {})
    })
  });

  const navigation = controller.navigate('#/next');
  await Promise.resolve();

  assert.deepEqual(events, ['shell-mount']);
  assert.doesNotMatch(outlet.innerHTML, /data-route-loading/);
  assert.equal(controller.currentView, oldView);

  assert.equal(releaseCleanup, undefined, 'the visible view is not cleaned before the replacement is ready');
  assert.ok(navigation instanceof Promise);
});

test('a stale route load cannot render over the latest navigation', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  let releaseFirstLoad;
  const rendered = [];
  const mounted = [];
  const routes = {
    '#/first': {
      routeKey: 'first',
      exportName: 'FirstView',
      args: [],
      load: () => new Promise(resolve => { releaseFirstLoad = () => resolve({ FirstView: { render: () => rendered.push('first') } }); })
    },
    '#/second': {
      routeKey: 'second',
      exportName: 'SecondView',
      args: [],
      load: () => Promise.resolve({ SecondView: { render: () => rendered.push('second') } })
    }
  };
  const controller = createNavigationController({
    appShell: {
      cleanup() {},
      mount() {
        const outlet = { innerHTML: '' };
        mounted.push(outlet);
        return outlet;
      }
    },
    wordStudyDetail: { close() {} },
    getApp: () => ({ id: 'app' }),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => routes[hash]
  });

  const firstNavigation = controller.navigate('#/first');
  const secondNavigation = controller.navigate('#/second');
  await secondNavigation;
  releaseFirstLoad();
  await firstNavigation;

  assert.deepEqual(rendered, ['second']);
  assert.equal(controller.navigationToken, 2);
  assert.equal(controller.currentView?.render ? true : false, true);
  assert.equal(mounted.length, 2);
});

test('parameter routes strip the query before decoding and survive invalid encoding', async () => {
  const { resolveRoute } = await import('../src/router-routes.mjs');

});

test('parameter routes without an id fall to an explicit not-found shell', async () => {
  const { resolveRoute } = await import('../src/router-routes.mjs');

  for (const hash of ['#/reading/', '#/reading']) {
    assert.equal(resolveRoute(hash).routeKey, 'not-found', `${hash} must not enter a business view`);
  }
  assert.equal(resolveRoute('#/reading/42').routeKey, 'reading');
});

test('the not-found route renders a recoverable shell', async () => {
  const { resolveRoute } = await import('../src/router-routes.mjs');
  const route = resolveRoute('#/reading/');
  const module = await route.load();
  const view = module[route.exportName];
  assert.equal(typeof view.render, 'function');
  const outlet = { innerHTML: '' };
  await view.render(outlet);
  assert.match(outlet.innerHTML, /页面不存在/);
  assert.ok(outlet.innerHTML.includes('#/chat'));
});

test('a stale load rejection cannot put an error into the latest navigation outlet', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  let rejectFirst;
  const mounted = [];
  const routes = {
    '#/first': {
      routeKey: 'first', exportName: 'FirstView', args: [],
      load: () => new Promise((_, reject) => { rejectFirst = () => reject(new Error('boom')); })
    },
    '#/second': {
      routeKey: 'second', exportName: 'SecondView', args: [],
      load: () => Promise.resolve({ SecondView: { render: outlet => { outlet.innerHTML = '<p>second</p>'; } } })
    }
  };
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { const outlet = { innerHTML: '' }; mounted.push(outlet); return outlet; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => routes[hash],
    onRenderError: () => { throw new Error('stale error must not be reported as current'); }
  });

  const first = controller.navigate('#/first');
  const second = controller.navigate('#/second');
  await second;
  rejectFirst();
  const firstResult = await first;

  assert.equal(firstResult.ok, false);
  assert.equal(firstResult.stale, true);
  assert.equal(mounted[1].innerHTML.includes('页面暂时无法打开'), false, 'the latest outlet must stay clean');
  assert.match(mounted[1].innerHTML, /second/);
});

test('a stale render resolution leaves the latest view and DOM in place', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  let finishFirstRender;
  const mounted = [];
  const secondView = { render: outlet => { outlet.innerHTML = '<p>second</p>'; } };
  const firstView = {
    render: outlet => new Promise(resolve => {
      finishFirstRender = () => { outlet.innerHTML = '<p>first-late</p>'; resolve(); };
    })
  };
  const routes = {
    '#/first': { routeKey: 'first', exportName: 'FirstView', args: [], load: () => Promise.resolve({ FirstView: firstView }) },
    '#/second': { routeKey: 'second', exportName: 'SecondView', args: [], load: () => Promise.resolve({ SecondView: secondView }) }
  };
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { const outlet = { innerHTML: '' }; mounted.push(outlet); return outlet; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => routes[hash]
  });

  const first = controller.navigate('#/first');
  // 等待必须跨越宏任务边界，确保第一次 render 已经启动。
  await new Promise(resolve => setTimeout(resolve, 0));
  const second = controller.navigate('#/second');
  await second;
  finishFirstRender();
  const firstResult = await first;

  assert.equal(firstResult.stale, true);
  assert.equal(controller.currentView, secondView, 'current view stays the second route view object');
  assert.match(mounted[1].innerHTML, /second/);
  assert.doesNotMatch(mounted[1].innerHTML, /first-late/, 'the stale render must not write into the live outlet');
});

test('a singleton view revisited before its cleanup settles renders only after that cleanup', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const events = [];
  let releaseFirstCleanup;
  let firstCleanupStarted = false;
  const singletonView = {
    render: outlet => { events.push(`render:${outlet.name}`); },
    cleanup() {
      if (!firstCleanupStarted) {
        firstCleanupStarted = true;
        events.push('cleanup:1');
        return new Promise(resolve => { releaseFirstCleanup = resolve; });
      }
      events.push('cleanup:2');
    }
  };
  const mounted = [];
  const routes = {
    '#/a': { routeKey: 'a', exportName: 'SingletonView', args: [], load: () => Promise.resolve({ SingletonView: singletonView }) },
    '#/b': { routeKey: 'b', exportName: 'OtherView', args: [], load: () => Promise.resolve({ OtherView: { render: outlet => events.push(`render:${outlet.name}`) } }) }
  };
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { const outlet = { innerHTML: '', name: `outlet-${mounted.length + 1}` }; mounted.push(outlet); return outlet; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => routes[hash]
  });

  const first = controller.navigate('#/a');
  await first;
  const second = controller.navigate('#/b');
  await second;
  const third = controller.navigate('#/a');
  // Give the third navigation time to reach its pending-cleanup wait; the
  // first cleanup is still ours to release, so no render may happen yet.
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(events.slice(-1), ['cleanup:1'], 'the revisited singleton waits for its prior async cleanup');
  releaseFirstCleanup();
  await third;

  assert.equal(events.filter(entry => entry === 'render:outlet-3').length, 1, 'exactly one render for the final navigation');
  assert.ok(events.indexOf('cleanup:1') < events.indexOf('render:outlet-3'), 'the new render waits for the prior cleanup');
  assert.ok(controller.currentView === singletonView);
});

test('a rejected view cleanup does not block the next navigation', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const cleanupErrors = [];
  const mounted = [];
  const routes = {
    '#/bad': { routeKey: 'bad', exportName: 'BadView', args: [], load: () => Promise.resolve({ BadView: { render() {}, cleanup() { return Promise.reject(new Error('cleanup failed')); } } }) },
    '#/next': { routeKey: 'next', exportName: 'NextView', args: [], load: () => Promise.resolve({ NextView: { render: outlet => { outlet.innerHTML = '<p>next</p>'; } } }) }
  };
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { const outlet = { innerHTML: '' }; mounted.push(outlet); return outlet; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => routes[hash],
    onCleanupError: error => cleanupErrors.push(error)
  });

  await controller.navigate('#/bad');
  const next = await controller.navigate('#/next');
  // The rejected cleanup is reported from an un-awaited promise chain; let it
  // settle before asserting.
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(next.ok, true);
  assert.equal(cleanupErrors.length, 1, 'the cleanup rejection was reported once');
  assert.match(mounted.at(-1).innerHTML, /next/);
});

test('repeatedly triggering the same route keeps exactly one live navigation', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const mounted = [];
  let renderCount = 0;
  const routes = {
    '#/same': {
      routeKey: 'same', exportName: 'SameView', args: [],
      load: () => Promise.resolve({ SameView: { render: outlet => { renderCount += 1; outlet.innerHTML = `<p>same-${renderCount}</p>`; } } })
    }
  };
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { const outlet = { innerHTML: '' }; mounted.push(outlet); return outlet; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: () => routes['#/same']
  });

  const first = controller.navigate('#/same');
  const second = controller.navigate('#/same');
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.stale, true);
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.token, firstResult.token + 1);
  assert.match(mounted.at(-1).innerHTML, /same-1/);
  assert.equal(mounted.length, 2, 'each navigation mounts its own outlet');
});

test('navigation stage evidence is privacy safe, ordered, and uses the injected monotonic clock', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const events = [];
  let fakeNow = 1000;

  const view = { render: () => { fakeNow = 1009; } };
  // shell mounting happens synchronously inside navigate(); the clock only
  // advances inside the load/render stubs.
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { return { innerHTML: '' }; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => ({
      routeKey: 'profile',
      exportName: 'ExamResultView',
      args: [decodeURIComponent(hash.split('/').pop())],
      load: () => {
        fakeNow = 1005;
        return Promise.resolve().then(() => { fakeNow = 1007; return { ExamResultView: view }; });
      }
    }),
    recordEvent: (event, payload) => events.push({ event, payload }),
    now: () => fakeNow
  });

  const navigation = controller.navigate('#/profile?from=history');
  await navigation;

  assert.deepEqual(events.map(entry => entry.event), [
    'route_started',
    'route_shell_mounted',
    'route_module_loaded',
    'route_dom_committed',
    'route_render_completed'
  ]);
  const payloads = events.map(entry => entry.payload);
  assert.ok(payloads.every(payload => payload.routeKey === 'profile'), 'only the route key is recorded');
  assert.ok(payloads.every(payload => !JSON.stringify(payload).includes('attempt%2F1')), 'no article ids are recorded');
  assert.ok(payloads.every(payload => !JSON.stringify(payload).includes('from=history')), 'no query strings are recorded');
  assert.ok(payloads.every(payload => typeof payload.correlationId === 'string' && payload.correlationId.length > 0));
  assert.equal(payloads[1].durationMs, 5, 'shell mount is measured on the injected monotonic clock');
  assert.equal(payloads[2].durationMs, 7);
  assert.equal(payloads[3].durationMs, 9);
  assert.equal(payloads[4].durationMs, 9);
  assert.equal(payloads[4].result, 'ok');
  assert.equal(payloads[4].token, 1);
});

test('stage evidence marks stale navigations as superseded instead of errors', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const firstEvents = [];
  let releaseFirstLoad;
  const routes = {
    '#/first': { routeKey: 'first', exportName: 'FirstView', args: [], load: () => new Promise(resolve => { releaseFirstLoad = () => resolve({ FirstView: { render() {} } }); }) },
    '#/second': { routeKey: 'second', exportName: 'SecondView', args: [], load: () => Promise.resolve({ SecondView: { render() {} } }) }
  };
  const makeController = recorder => createNavigationController({
    appShell: { cleanup() {}, mount() { return { innerHTML: '' }; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => routes[hash],
    recordEvent: recorder
  });

  const firstRecorder = (event, payload) => { if (payload.token === 1) firstEvents.push({ event, payload }); };
  const controller = makeController(firstRecorder);
  const first = controller.navigate('#/first');
  controller.navigate('#/second');
  releaseFirstLoad();
  await first;

  const last = firstEvents.at(-1);
  assert.equal(last.event, 'route_render_completed');
  assert.equal(last.payload.result, 'superseded');
  assert.ok(!firstEvents.some(entry => entry.payload.result === 'failed'), 'a stale navigation is not an error');
});

test('stage evidence marks current-page render failures with a stable outcome', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const events = [];
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { return { innerHTML: '' }; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: () => ({ routeKey: 'broken', exportName: 'BrokenView', args: [], load: () => Promise.resolve({ BrokenView: { render() { throw new Error('render boom'); } } }) }),
    recordEvent: (event, payload) => events.push({ event, payload }),
    onRenderError: () => {}
  });

  const result = await controller.navigate('#/broken');

  assert.equal(result.ok, false);
  const last = events.at(-1);
  assert.equal(last.event, 'route_render_completed');
  assert.equal(last.payload.result, 'failed');
  assert.equal(last.payload.errorName, 'Error');
  assert.ok(!JSON.stringify(last.payload).includes('boom'), 'error messages are not recorded');
});

test('the controller serializes same-view renders so a superseded render cannot overwrite the live one', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const mounted = [];
  let releaseFirstRender;
  // 生产页面不感知任何生命周期上下文：这个单例视图只拿 outlet，迟到回调无条件
  // 覆盖共享状态与它持有的旧 outlet。防护必须完全由控制器执行。
  let firstRenderOfA = true;
  const singletonView = {
    phase: 'idle',
    cleanup() {},
    render(outlet) {
      if (firstRenderOfA) {
        // 第一次 render 异步挂起，稍后由测试释放；它的迟到回调无条件覆盖。
        firstRenderOfA = false;
        singletonView.phase = 'rendering';
        return new Promise(resolve => {
          releaseFirstRender = () => {
            singletonView.phase = 'stale';
            outlet.innerHTML = '<p>stale-first</p>';
            resolve();
          };
        });
      }
      // 与生产页面一致的第二次 render：正常完成，不检查任何生命周期信息。
      singletonView.phase = 'fresh';
      outlet.innerHTML = '<p>a-page</p>';
    }
  };
  const routes = {
    '#/a': { routeKey: 'a', exportName: 'SingletonView', args: [], load: () => Promise.resolve({ SingletonView: singletonView }) },
    '#/b': { routeKey: 'b', exportName: 'OtherView', args: [], load: () => Promise.resolve({ OtherView: { render: outlet => { outlet.innerHTML = '<p>b-page</p>'; singletonView.phase = 'fresh'; } } }) }
  };
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { const outlet = { innerHTML: '' }; mounted.push(outlet); return outlet; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => routes[hash]
  });

  const first = controller.navigate('#/a');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(singletonView.phase, 'rendering', 'the first render is still in flight');
  await controller.navigate('#/b');
  assert.equal(singletonView.phase, 'fresh');
  const third = controller.navigate('#/a');
  // 目标 outlet 同步准备但不显示通用 Loading；真实 AppShell 会继续显示上一页直到提交。
  assert.doesNotMatch(mounted[2].innerHTML, /data-route-loading/, 'the staging outlet never shows a generic loader');
  assert.doesNotMatch(mounted[2].innerHTML, /b-page/, 'the previous page does not stay visible');

  // 释放与第三次导航赛跑：无论控制器是否重排执行顺序，释放都必然发生一次。
  let released = false;
  const releaseOnce = () => {
    if (!released) {
      released = true;
      releaseFirstRender();
    }
  };
  await Promise.race([
    third,
    new Promise(resolve => setTimeout(() => { releaseOnce(); resolve(); }, 25))
  ]);
  releaseOnce();
  await third.catch(() => {});
  await first;

  assert.equal(singletonView.phase, 'fresh', 'the superseded render must not overwrite the live shared state');
  assert.match(mounted[2].innerHTML, /a-page/, '');
  assert.doesNotMatch(mounted[2].innerHTML, /stale-first/, 'the late stale content never reaches the live outlet');
  assert.equal(controller.currentView, singletonView);
});

test('route render keeps business parameters positional and passes no lifecycle object', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const { resolveRoute } = await import('../src/router-routes.mjs');
  const seen = [];
  const views = {
    FlashcardView: { render: (outlet, ...rest) => { seen.push({ view: 'flashcard', rest }); outlet.innerHTML = '<p>recall-ok</p>'; } },
    ReadingView: { render: (outlet, ...rest) => { seen.push({ view: 'reading', rest }); outlet.innerHTML = '<p>reading-ok</p>'; } }
  };
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { const outlet = { innerHTML: '' }; return outlet; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => {
      const route = resolveRoute(hash);
      return { ...route, load: () => Promise.resolve({ [route.exportName]: views[route.exportName] }) };
    }
  });

  await controller.navigate('#/flashcard/recall');
  await controller.navigate('#/reading/42');

  const flashcardCall = seen.find(entry => entry.view === 'flashcard');
  assert.ok(flashcardCall, 'the flashcard view rendered');
  assert.deepEqual(flashcardCall.rest, [], 'an empty-args route must pass no extra arguments at all');

  const readingCall = seen.find(entry => entry.view === 'reading');
  assert.ok(readingCall, 'the reading view rendered');
  assert.deepEqual(readingCall.rest, [42], 'a one-argument route passes exactly its business argument');
});

test('a queued stale render skips business work but still tears down late effects from the prior render', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  let releaseA1;
  const globalListeners = [];
  const views = {
    a: {
      cleanupCount: 0,
      renderCalls: 0,
      cleanup() {
        this.cleanupCount += 1;
        globalListeners.length = 0;
      },
      render(outlet) {
        this.renderCalls += 1;
        outlet.innerHTML = '<p>a-page</p>';
        if (this.renderCalls === 1) {
          return new Promise(resolve => {
            releaseA1 = () => {
              globalListeners.push('a1-late-listener');
              resolve();
            };
          });
        }
        globalListeners.push('a2-listener');
      }
    },
    b: {
      cleanupCount: 0,
      renderCalls: 0,
      cleanup() { this.cleanupCount += 1; },
      render(outlet) { this.renderCalls += 1; outlet.innerHTML = '<p>b-page</p>'; }
    },
    c: {
      cleanupCount: 0,
      renderCalls: 0,
      cleanup() { this.cleanupCount += 1; },
      render(outlet) { this.renderCalls += 1; outlet.innerHTML = '<p>c-page</p>'; }
    }
  };
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { const outlet = { innerHTML: '' }; return outlet; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => {
      const view = views[hash.replace('#/', '')];
      return { routeKey: hash, exportName: 'View', args: [], load: () => Promise.resolve({ View: view }) };
    }
  });

  // A1 render 挂起。
  const first = controller.navigate('#/a');
  await new Promise(resolve => setTimeout(resolve, 0));
  // A2 导航开始并进入对 A1 的等待。
  const second = controller.navigate('#/a');
  await new Promise(resolve => setTimeout(resolve, 0));
  // 用户导航到 B，B 正常显示。
  await controller.navigate('#/b');

  releaseA1();

  const secondResult = await second;
  await first;
  assert.equal(secondResult.stale, true, 'A2 was superseded by B while waiting and must report stale');
  assert.equal(views.a.renderCalls, 1, 'the abandoned A2 must never call render again');
  assert.equal(controller.currentView, views.b, 'currentView must stay on B');
  assert.deepEqual(globalListeners, [], 'A1 late effects must be torn down even though the waiting A2 is stale');

  // 离开 B 时清理的是 B；A 只包含早期 cleanup 与 A1 完成后的补偿 teardown。
  await controller.navigate('#/c');
  assert.equal(views.b.cleanupCount, 1, 'leaving B cleans up B');
  assert.equal(views.a.cleanupCount, 2, 'A1 receives exactly one compensating teardown after its late completion');
});

test('the controller tears down a finished stale render before starting the live one', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const globalListeners = [];
  const lifecycleEvents = [];
  let releaseFirstRender;
  let firstRenderOfA = true;
  const singletonView = {
    cleanupCount: 0,
    cleanup() {
      this.cleanupCount += 1;
      globalListeners.length = 0;
      lifecycleEvents.push(`cleanup-${this.cleanupCount}`);
    },
    render(outlet) {
      if (firstRenderOfA) {
        firstRenderOfA = false;
        lifecycleEvents.push('render-a1');
        return new Promise(resolve => {
          releaseFirstRender = () => {
            // A1 完成时的迟到行为：像生产页面一样重新绑定全局监听器。
            globalListeners.push('a1-late-listener');
            lifecycleEvents.push('a1-late-bind');
            outlet.innerHTML = '<p>stale-first</p>';
            resolve();
          };
        });
      }
      globalListeners.push('a2-listener');
      lifecycleEvents.push('render-a2');
      outlet.innerHTML = '<p>a-page</p>';
    }
  };
  const mounted = [];
  const routes = {
    '#/a': { routeKey: 'a', exportName: 'SingletonView', args: [], load: () => Promise.resolve({ SingletonView: singletonView }) },
    '#/b': { routeKey: 'b', exportName: 'OtherView', args: [], load: () => Promise.resolve({ OtherView: { render: outlet => { outlet.innerHTML = '<p>b-page</p>'; } } }) }
  };
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { const outlet = { innerHTML: '' }; mounted.push(outlet); return outlet; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => routes[hash]
  });

  const first = controller.navigate('#/a');
  await new Promise(resolve => setTimeout(resolve, 0));
  await controller.navigate('#/b');
  assert.deepEqual(lifecycleEvents, ['render-a1', 'cleanup-1'], 'leaving A runs its cleanup once while A1 is still in flight');
  assert.deepEqual(globalListeners, []);

  const third = controller.navigate('#/a');
  assert.doesNotMatch(mounted[2].innerHTML, /data-route-loading/, 'the staging outlet does not introduce a generic loader');
  let released = false;
  const releaseOnce = () => {
    if (!released) {
      released = true;
      releaseFirstRender();
    }
  };
  await Promise.race([
    third,
    new Promise(resolve => setTimeout(() => { releaseOnce(); resolve(); }, 25))
  ]);
  releaseOnce();
  await third.catch(() => {});
  await first;

  assert.deepEqual(globalListeners, ['a2-listener'], 'only the live render may keep a listener');
  assert.equal(singletonView.cleanupCount, 2, 'the finished stale render gets its own teardown before A2 starts');
  assert.deepEqual(lifecycleEvents, ['render-a1', 'cleanup-1', 'a1-late-bind', 'cleanup-2', 'render-a2']);
  assert.match(mounted[2].innerHTML, /a-page/);
  assert.doesNotMatch(mounted[2].innerHTML, /stale-first/);
});

test('a throwing teardown cleanup does not block the next same-view render', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const cleanupErrors = [];
  const globalListeners = [];
  let releaseFirstRender;
  let firstRenderOfA = true;
  const singletonView = {
    cleanupCount: 0,
    cleanup() {
      this.cleanupCount += 1;
      globalListeners.length = 0;
      throw new Error(`cleanup boom ${this.cleanupCount}`);
    },
    render(outlet) {
      if (firstRenderOfA) {
        firstRenderOfA = false;
        return new Promise(resolve => {
          releaseFirstRender = () => {
            globalListeners.push('a1-late-listener');
            outlet.innerHTML = '<p>stale-first</p>';
            resolve();
          };
        });
      }
      globalListeners.push('a2-listener');
      outlet.innerHTML = '<p>a-page</p>';
    }
  };
  const mounted = [];
  const routes = {
    '#/a': { routeKey: 'a', exportName: 'SingletonView', args: [], load: () => Promise.resolve({ SingletonView: singletonView }) },
    '#/b': { routeKey: 'b', exportName: 'OtherView', args: [], load: () => Promise.resolve({ OtherView: { render: outlet => { outlet.innerHTML = '<p>b-page</p>'; } } }) }
  };
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { const outlet = { innerHTML: '' }; mounted.push(outlet); return outlet; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => routes[hash],
    onCleanupError: error => cleanupErrors.push(error)
  });

  const first = controller.navigate('#/a');
  await new Promise(resolve => setTimeout(resolve, 0));
  await controller.navigate('#/b');
  const third = controller.navigate('#/a');
  let released = false;
  const releaseOnce = () => {
    if (!released) {
      released = true;
      releaseFirstRender();
    }
  };
  await Promise.race([
    third,
    new Promise(resolve => setTimeout(() => { releaseOnce(); resolve(); }, 25))
  ]);
  releaseOnce();
  await third.catch(() => {});
  await first;

  assert.deepEqual(globalListeners, ['a2-listener'], 'A2 still renders and owns the only listener');
  assert.match(mounted[2].innerHTML, /a-page/);
  assert.deepEqual(
    cleanupErrors.map(error => error.message),
    ['cleanup boom 1', 'cleanup boom 2'],
    'each throwing cleanup is reported exactly once without blocking'
  );
});

test('navigation writes real User Timing marks and measures through the first painted frame', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const marks = [];
  const measures = [];
  const paintedRoutes = [];
  const controller = createNavigationController({
    appShell: {
      mount() { return { innerHTML: '' }; },
      commitRoute() {}
    },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: () => ({
      routeKey: 'timed', exportName: 'View', args: [],
      load: () => Promise.resolve({ View: { render(outlet) { outlet.innerHTML = '<p>ready</p>'; } } })
    }),
    performanceTimeline: {
      mark(name) { marks.push(name); },
      measure(name, start, end) { measures.push({ name, start, end }); }
    },
    afterPaint: callback => callback(),
    onFirstMeaningfulPaint: payload => paintedRoutes.push(payload.routeKey)
  });

  await controller.navigate('#/timed');

  assert.ok(marks.some(name => name.endsWith(':route_started')));
  assert.ok(marks.some(name => name.endsWith(':route_first_meaningful_paint')));
  assert.ok(measures.some(entry => entry.name === 'english-reader:route:first-meaningful-paint'));
  assert.deepEqual(paintedRoutes, ['timed']);
});

test('render tracking entries are released after completion and rejection', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const tracker = new Map();
  let releaseFirstRender;
  let firstRenderOfA = true;
  const routes = {
    '#/a': {
      routeKey: 'a', exportName: 'AView', args: [],
      load: () => Promise.resolve({
        AView: {
          render(outlet) {
            if (firstRenderOfA) {
              firstRenderOfA = false;
              return new Promise(resolve => { releaseFirstRender = resolve; });
            }
            outlet.innerHTML = '<p>a-page</p>';
          }
        }
      })
    },
    '#/broken': {
      routeKey: 'broken', exportName: 'BrokenView', args: [],
      load: () => Promise.resolve({ BrokenView: { render() { throw new Error('render boom'); } } })
    },
    '#/ok': {
      routeKey: 'ok', exportName: 'OkView', args: [],
      load: () => Promise.resolve({ OkView: { render: outlet => { outlet.innerHTML = '<p>ok</p>'; } } })
    }
  };
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { return { innerHTML: '' }; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => routes[hash],
    onRenderError: () => {},
    pendingRenderTracker: tracker
  });

  const first = controller.navigate('#/a');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(tracker.size, 1, 'an in-flight render is tracked');

  releaseFirstRender();
  await first;
  assert.equal(tracker.size, 0, 'a completed render releases its tracking entry');

  const broken = await controller.navigate('#/broken');
  assert.equal(broken.ok, false);
  assert.equal(tracker.size, 0, 'a rejected render releases its tracking entry too');

  const again = await controller.navigate('#/ok');
  assert.equal(again.ok, true, 're-entering an already-rendered page works without a stale claim wait');
  assert.equal(tracker.size, 0);
});

test('navigation keeps the current page visible until the next page commits without a generic loading screen', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const events = [];
  let releaseLoad;
  const currentView = { cleanup() { events.push('current-cleanup'); } };
  const stagingOutlet = { innerHTML: '<p>old-page</p>' };
  const controller = createNavigationController({
    initialView: currentView,
    appShell: {
      cleanup() { events.push('shell-cleanup'); },
      mount() { events.push('prepare'); return stagingOutlet; },
      commitRoute(outlet) { events.push(`commit:${outlet.innerHTML}`); }
    },
    wordStudyDetail: { close() { events.push('detail-close'); } },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '下一页' }),
    resolveRoute: () => ({
      routeKey: 'next',
      exportName: 'NextView',
      args: [],
      cachePolicy: 'dispose',
      load: () => new Promise(resolve => { releaseLoad = () => resolve({ NextView: { render(outlet) { outlet.innerHTML = '<p>next-page</p>'; } } }); })
    })
  });

  const navigation = controller.navigate('#/next');
  await Promise.resolve();

  assert.equal(stagingOutlet.innerHTML, '<p>old-page</p>', 'loading a module must not replace visible content with a loader');
  assert.deepEqual(events, ['prepare'], 'the live page and persistent shell stay mounted before commit');

  releaseLoad();
  await navigation;

  assert.deepEqual(events, ['prepare', 'commit:<p>next-page</p>', 'detail-close', 'current-cleanup']);
  assert.ok(!events.some(event => event.includes('shell-cleanup')), 'ordinary navigation never tears down the persistent shell');
});

test('core route warmup and data preload are promise-deduplicated', async () => {
  const { resolveRoute, warmCoreRoutes, preloadRoute } = await import('../src/router-routes.mjs');
  const vocabulary = resolveRoute('#/vocab');
  const localRoute = resolveRoute('#/reading');

  assert.equal(vocabulary.cachePolicy, 'keep-alive');
  assert.equal(typeof vocabulary.warmup, 'function');
  assert.equal(typeof vocabulary.preloadData, 'function');
  assert.strictEqual(localRoute.warmup(), localRoute.warmup(), 'module warmup shares one in-flight promise');
  assert.strictEqual(preloadRoute('#/reading'), preloadRoute('#/reading'), 'intent preloading shares one in-flight promise');

  const warmedHashes = [];
  const warmed = warmCoreRoutes({
    schedule: callback => callback(),
    preload: hash => { warmedHashes.push(hash); return Promise.resolve(); }
  });
  assert.ok(warmed instanceof Promise);
  await warmed;
  assert.deepEqual(warmedHashes, ['#/history', '#/vocab', '#/reading-list', '#/flashcard', '#/profile']);
});

test('legacy stats and profile hashes share one keep-alive identity for their singleton view', async () => {
  const { resolveRoute } = await import('../src/router-routes.mjs');
  const legacy = resolveRoute('#/stats');
  const profile = resolveRoute('#/profile');

  assert.equal(legacy.routeKey, profile.routeKey);
  assert.equal(legacy.cachePolicy, 'keep-alive');
  assert.equal(profile.cachePolicy, 'keep-alive');
});

test('a cached keep-alive route reactivates without loading or rendering again', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const calls = [];
  const outlets = new Map();
  const views = {
    a: {
      render(outlet) { calls.push('render-a'); outlet.innerHTML = '<p>a</p>'; },
      activate() { calls.push('activate-a'); },
      deactivate() { calls.push('deactivate-a'); },
      dispose() { calls.push('dispose-a'); }
    },
    b: { render(outlet) { calls.push('render-b'); outlet.innerHTML = '<p>b</p>'; }, cleanup() { calls.push('cleanup-b'); } }
  };
  let aLoads = 0;
  const routes = {
    '#/a': { routeKey: 'a', exportName: 'View', args: [], cachePolicy: 'keep-alive', load: () => { aLoads += 1; return Promise.resolve({ View: views.a }); } },
    '#/b': { routeKey: 'b', exportName: 'View', args: [], cachePolicy: 'dispose', load: () => Promise.resolve({ View: views.b }) }
  };
  const controller = createNavigationController({
    appShell: {
      mount(_app, _meta, _mode, _hash, options) {
        if (!outlets.has(options.routeKey)) outlets.set(options.routeKey, { innerHTML: '' });
        return outlets.get(options.routeKey);
      },
      commitRoute() {},
      releaseRoute() {}
    },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => routes[hash]
  });

  await controller.navigate('#/a');
  await controller.navigate('#/b');
  await controller.navigate('#/a');

  assert.equal(aLoads, 1, 'returning to a cached route does not load its module again');
  assert.deepEqual(calls, ['render-a', 'render-b', 'deactivate-a', 'activate-a', 'cleanup-b']);
  assert.match(outlets.get('a').innerHTML, /<p>a<\/p>/, 'the original DOM is reused');
});

test('keep-alive LRU evicts the oldest inactive page and releases all of its resources', async () => {
  const { createNavigationController } = await import('../src/router-navigation.mjs');
  const events = [];
  const outlets = new Map();
  const routes = Object.fromEntries(['a', 'b', 'c', 'd'].map(key => {
    const view = {
      render(outlet) {
        events.push(`render-${key}`);
        outlet.innerHTML = `<p>${key}</p>`;
      },
      deactivate() { events.push(`deactivate-${key}`); },
      dispose() { events.push(`dispose-${key}`); }
    };
    return [`#/${key}`, {
      routeKey: key,
      exportName: 'View',
      args: [],
      cachePolicy: 'keep-alive',
      load: () => Promise.resolve({ View: view })
    }];
  }));
  const controller = createNavigationController({
    maxCachedRoutes: 3,
    appShell: {
      mount(_app, _meta, _mode, _hash, options) {
        if (!outlets.has(options.routeKey)) outlets.set(options.routeKey, { innerHTML: '' });
        return outlets.get(options.routeKey);
      },
      commitRoute() {},
      releaseRoute(routeKey) {
        events.push(`release-${routeKey}`);
        outlets.delete(routeKey);
      }
    },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '页面' }),
    resolveRoute: hash => routes[hash]
  });

  await controller.navigate('#/a');
  await controller.navigate('#/b');
  await controller.navigate('#/c');
  await controller.navigate('#/d');
  await Promise.resolve();

  assert.equal(outlets.has('a'), false, 'the oldest inactive DOM is removed');
  assert.equal(events.filter(event => event === 'dispose-a').length, 1, 'the evicted view is permanently disposed once');
  assert.equal(events.filter(event => event === 'release-a').length, 1, 'the shell releases the evicted route once');
  assert.equal(events.includes('dispose-d'), false, 'the active page is never evicted');
  assert.equal(outlets.size, 3, 'only the three most recently used pages remain mounted');
});
