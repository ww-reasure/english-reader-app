import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readText = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('app shell and first route start before asynchronous secure configuration and DB preconnect settle', async () => {
  const source = await readText('src/app.js');
  const initStart = source.indexOf('async init()');
  const init = source.slice(initStart, source.indexOf('\n  initReviewPersistenceLifecycle()', initStart));
  const routerStart = init.indexOf('Router.init()');
  const configAwait = init.indexOf('await Promise.allSettled([configReady');

  assert.ok(routerStart >= 0 && configAwait > routerStart, 'the visible app starts before secure configuration finishes');
  assert.match(init, /const configReady = Config\.initialize\(\)/);
  assert.match(init, /const databaseReady = DB\.open\(\)/);
  assert.match(init, /Promise\.allSettled\(\[configReady, databaseReady/);
});

test('unused native and plugin TTS startup paths are completely absent', async () => {
  const [activity, manifest, packageJson, buildScript] = await Promise.all([
    readText('android/app/src/main/java/com/example/englishreader/MainActivity.java'),
    readText('android/app/src/main/AndroidManifest.xml'),
    readText('package.json'),
    readText('scripts/build-apk.js')
  ]);
  const combined = `${activity}\n${manifest}\n${packageJson}\n${buildScript}`;

  assert.doesNotMatch(combined, /TtsBridge|TextToSpeech|TTS_SERVICE|@capacitor-community\/text-to-speech|ensureLegacyTextToSpeechNamespace/);
});

test('release build does not duplicate source files or decode the multi-megabyte paper texture', async () => {
  const [vite, css] = await Promise.all([readText('vite.config.js'), readText('css/style.css')]);

  assert.doesNotMatch(vite, /copySrcPlugin|www\/src|www\\src/);
  assert.doesNotMatch(css, /learning-paper-texture\.png/);
  assert.match(css, /--paper-noise/);
});

test('Android reports fully drawn only after the router commits a meaningful painted frame', async () => {
  const [activity, router] = await Promise.all([
    readText('android/app/src/main/java/com/example/englishreader/MainActivity.java'),
    readText('src/router.js')
  ]);

  assert.match(activity, /STARTUP_BRIDGE_NAME\s*=\s*"StartupMetricsBridge"/);
  assert.match(activity, /addJavascriptInterface\(startupMetricsBridge, STARTUP_BRIDGE_NAME\)/);
  assert.match(activity, /reportFullyDrawn\(\)/);
  assert.match(activity, /AtomicBoolean/);
  assert.match(router, /onFirstMeaningfulPaint:[\s\S]*StartupMetricsBridge\?\.reportFullyDrawn/);
});

test('WebView 1.16 asynchronous startup stays behind an opt-in benchmark flag', async () => {
  const [application, appGradle, variables, manifest] = await Promise.all([
    readText('android/app/src/main/java/com/example/englishreader/EnglishReaderApplication.java'),
    readText('android/app/build.gradle'),
    readText('android/variables.gradle'),
    readText('android/app/src/main/AndroidManifest.xml')
  ]);

  assert.match(variables, /androidxWebkitVersion\s*=\s*'1\.16\.0'/);
  assert.match(appGradle, /englishReaderAsyncWebViewStartup[\s\S]*?:\s*"false"/);
  assert.match(appGradle, /ENABLE_ASYNC_WEBVIEW_STARTUP/);
  assert.match(manifest, /android:name="\.EnglishReaderApplication"/);
  assert.match(application, /if \(!BuildConfig\.ENABLE_ASYNC_WEBVIEW_STARTUP\) return;/);
  assert.match(application, /WebViewCompat\.startUpWebView/);
  assert.match(application, /WebViewStartUpConfig\.Builder/);
});
