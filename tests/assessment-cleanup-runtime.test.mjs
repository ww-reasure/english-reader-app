import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

function installBrowserStubs() {
  const originals = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage
  };
  const existed = {
    window: Object.hasOwn(globalThis, 'window'),
    document: Object.hasOwn(globalThis, 'document'),
    localStorage: Object.hasOwn(globalThis, 'localStorage')
  };

  globalThis.window = globalThis;
  globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  globalThis.document = {
    createElement() {
      let text = '';
      return {
        get innerHTML() { return text; },
        get textContent() { return text; },
        set textContent(value) { text = String(value); }
      };
    },
    getElementById() { return null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; }
  };

  return () => {
    for (const key of Object.keys(originals)) {
      if (existed[key]) globalThis[key] = originals[key];
      else delete globalThis[key];
    }
  };
}

test('cleanup prevents an in-flight wait from writing into a detached outlet', async () => {
  const restoreBrowserStubs = installBrowserStubs();
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    const { AssessmentView } = await server.ssrLoadModule('/src/views/assessment.js');
    const originalState = AssessmentView.state;
    const originalContainer = AssessmentView.container;
    let html = '';
    const outlet = {
      querySelector() { return null; },
      get innerHTML() { return html; },
      set innerHTML(value) { html = value; }
    };

    AssessmentView.container = outlet;
    AssessmentView.state = {
      step: 'reading',
      targetExam: 'cet4',
      articles: [{ title: 'First', content: 'One.', difficulty: 'cet4', level: 'easy', wordCount: 1 }],
      currentArticle: 0,
      secondArticleError: '',
      clickedWords: [],
      selfAssessment: [50, 50],
      articleReadStartedAt: Date.now() - 1000,
      readingDurations: [0, 0],
      readingTime: 0,
      quizAnswers: [{}, {}],
      assessmentRunId: 17,
      generationController: new AbortController()
    };

    const waiting = AssessmentView.finishReading();
    await new Promise(resolve => setTimeout(resolve, 20));
    AssessmentView.cleanup();
    outlet.innerHTML = '<detached-outlet>';
    AssessmentView.state.secondArticleError = 'cancelled';
    await waiting;

    assert.equal(outlet.innerHTML, '<detached-outlet>');
    AssessmentView.state = originalState;
    AssessmentView.container = originalContainer;
  } finally {
    await server.close();
    restoreBrowserStubs();
  }
});
