package com.example.englishreader;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends BridgeActivity {
    private static final String STARTUP_BRIDGE_NAME = "StartupMetricsBridge";
    private final AtomicBoolean fullyDrawnReported = new AtomicBoolean(false);
    private StartupMetricsBridge startupMetricsBridge;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = this.bridge == null ? null : this.bridge.getWebView();
        if (webView != null) {
            startupMetricsBridge = new StartupMetricsBridge();
            webView.addJavascriptInterface(startupMetricsBridge, STARTUP_BRIDGE_NAME);
        }
    }

    @Override
    public void onDestroy() {
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().removeJavascriptInterface(STARTUP_BRIDGE_NAME);
        }
        startupMetricsBridge = null;
        super.onDestroy();
    }

    private final class StartupMetricsBridge {
        @JavascriptInterface
        public void reportFullyDrawn() {
            runOnUiThread(() -> {
                if (fullyDrawnReported.compareAndSet(false, true)) {
                    MainActivity.this.reportFullyDrawn();
                }
            });
        }
    }
}
