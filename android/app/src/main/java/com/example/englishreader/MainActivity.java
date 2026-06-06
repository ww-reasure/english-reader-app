package com.example.englishreader;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private TtsBridge ttsBridge;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ttsBridge = new TtsBridge(this);
        // 尽早注入——super.onCreate 后 bridge 已创建
        injectNow();
    }

    @Override
    public void onResume() {
        super.onResume();
        // 兜底：如果 onCreate 时 WebView 还没好，onResume 再试
        injectNow();
    }

    private void injectNow() {
        try {
            if (this.bridge == null) return;
            WebView webView = this.bridge.getWebView();
            if (webView == null) return;
            webView.addJavascriptInterface(ttsBridge, "TtsBridge");
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (ttsBridge != null) {
            ttsBridge.destroy();
            ttsBridge = null;
        }
    }
}
