/**
 * Text-to-Speech Module
 * Handles word pronunciation with multiple fallback strategies
 */

const TTS = {
  // Cache for audio URLs from dictionary lookups
  audioCache: new Map(),

  // Set audio URL for a word (called after dictionary lookup)
  setAudioUrl(word, url) {
    if (url) {
      this.audioCache.set(word.toLowerCase(), url);
    }
  },

  // Speak a word with retry mechanism
  speak(word) {
    if (!word) return;

    // Visual feedback
    this.highlightButton(word);

    // Try to play cached audio URL first (real human pronunciation)
    const audioUrl = this.audioCache.get(word.toLowerCase());
    if (audioUrl) {
      this.playAudio(audioUrl, word);
      return;
    }

    // Try native TtsBridge (Android TTS, most reliable)
    if (window.TtsBridge) {
      window.TtsBridge.speak(word);
      return;
    }

    // Retry TtsBridge injection (wait up to 2 seconds)
    this.retryBridge(word, 0);
  },

  // Play audio from URL
  playAudio(url, word) {
    try {
      const audio = new Audio(url);
      audio.play().catch(() => {
        // If audio fails, fallback to Google TTS
        this.googleSpeak(word);
      });
    } catch {
      this.googleSpeak(word);
    }
  },

  // Retry TtsBridge with exponential backoff
  retryBridge(word, attempt) {
    if (attempt >= 5) {
      this.fallbackSpeak(word);
      return;
    }

    if (window.TtsBridge) {
      window.TtsBridge.speak(word);
      return;
    }

    setTimeout(() => this.retryBridge(word, attempt + 1), 400);
  },

  // Fallback TTS methods
  fallbackSpeak(word) {
    // Try Capacitor TTS plugin
    if (window.Capacitor?.Plugins?.TextToSpeech) {
      window.Capacitor.Plugins.TextToSpeech.speak({
        text: word,
        lang: 'en-US',
        rate: 0.9,
        pitch: 1.0,
        volume: 1.0
      }).catch(() => {
        this.googleSpeak(word);
      });
      return;
    }

    // Try Google Translate TTS
    this.googleSpeak(word);
  },

  // Google Translate TTS (better quality than device TTS)
  googleSpeak(word) {
    try {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(word)}`;
      const audio = new Audio(url);
      audio.play().catch(() => {
        // Last resort: browser SpeechSynthesis
        this.browserSpeak(word);
      });
    } catch {
      this.browserSpeak(word);
    }
  },

  // Browser SpeechSynthesis (works on desktop)
  browserSpeak(word) {
    if (!('speechSynthesis' in window)) return;

    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      utterance.volume = 1.0;
      speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('SpeechSynthesis failed:', e);
    }
  },

  // Highlight the speak button briefly
  highlightButton(word) {
    const btns = document.querySelectorAll('.btn-speak');
    for (const btn of btns) {
      if (btn.getAttribute('data-word') === word) {
        btn.style.opacity = '0.5';
        setTimeout(() => { btn.style.opacity = '1'; }, 800);
        break;
      }
    }
  }
};
