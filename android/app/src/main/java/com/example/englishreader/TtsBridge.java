package com.example.englishreader;

import android.content.Context;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import java.util.Locale;
import java.util.ArrayList;
import android.os.Handler;
import android.os.Looper;

public class TtsBridge {
    private static final String TAG = "TtsBridge";
    private TextToSpeech tts;
    private volatile boolean ready = false;
    private Context context;
    private ArrayList<String> pendingSpeaks = new ArrayList<>();
    private Handler mainHandler;

    public TtsBridge(Context ctx) {
        this.context = ctx;
        this.mainHandler = new Handler(Looper.getMainLooper());
        tts = new TextToSpeech(ctx, new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                if (status == TextToSpeech.SUCCESS) {
                    int result = tts.setLanguage(Locale.US);
                    ready = (result != TextToSpeech.LANG_MISSING_DATA
                            && result != TextToSpeech.LANG_NOT_SUPPORTED);
                    Log.i(TAG, "TTS ready=" + ready + " langResult=" + result);
                    // 刷新积压的说话请求
                    if (ready) flushPending();
                } else {
                    Log.e(TAG, "TTS init FAILED status=" + status);
                }
            }
        });
    }

    private void flushPending() {
        synchronized (pendingSpeaks) {
            for (String text : pendingSpeaks) {
                Log.i(TAG, "flush pending: " + text);
                tts.speak(text, TextToSpeech.QUEUE_ADD, null, "tts_"+text.hashCode());
            }
            pendingSpeaks.clear();
        }
    }

    @android.webkit.JavascriptInterface
    public void speak(String text) {
        Log.i(TAG, "speak: text=" + text + " ready=" + ready + " tts=" + (tts!=null));
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (tts == null) return;
                if (ready) {
                    tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "tts_"+text.hashCode());
                } else {
                    // TTS 还没初始化好，放入积压队列
                    Log.i(TAG, "queuing speak (not ready yet)");
                    synchronized (pendingSpeaks) {
                        pendingSpeaks.add(text);
                    }
                }
            }
        });
    }

    public void destroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
    }
}
