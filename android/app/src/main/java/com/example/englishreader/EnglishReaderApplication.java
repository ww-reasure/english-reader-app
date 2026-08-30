package com.example.englishreader;

import android.app.Application;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewOutcomeReceiver;
import androidx.webkit.WebViewStartUpConfig;
import androidx.webkit.WebViewStartUpResult;
import androidx.webkit.WebViewStartupException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Opt-in WebView startup experiment. It is intentionally disabled in normal
 * builds until same-device Macrobenchmark results show a meaningful win.
 */
public class EnglishReaderApplication extends Application {
    private ExecutorService webViewStartupExecutor;

    @Override
    public void onCreate() {
        super.onCreate();
        if (!BuildConfig.ENABLE_ASYNC_WEBVIEW_STARTUP) return;

        webViewStartupExecutor = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "english-reader-webview-startup");
            thread.setDaemon(true);
            return thread;
        });
        WebViewStartUpConfig config = new WebViewStartUpConfig.Builder(webViewStartupExecutor).build();
        try {
            WebViewCompat.startUpWebView(
                this,
                config,
                new WebViewOutcomeReceiver<WebViewStartUpResult, WebViewStartupException>() {
                    @Override
                    public void onResult(WebViewStartUpResult result) {
                        releaseExecutor();
                    }

                    @Override
                    public void onError(WebViewStartupException error) {
                        releaseExecutor();
                    }
                }
            );
        } catch (RuntimeException error) {
            releaseExecutor();
        }
    }

    private void releaseExecutor() {
        ExecutorService executor = webViewStartupExecutor;
        webViewStartupExecutor = null;
        if (executor != null) executor.shutdown();
    }
}
