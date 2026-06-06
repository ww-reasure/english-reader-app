/**
 * Dictionary Module
 * Handles word lookup with local dictionary, online API, and AI fallback
 */

const Dictionary = {
  data: null,
  examWords: null,
  examFreq: null,
  cache: new Map(),

  // Load local dictionary
  async load() {
    if (this.data) return;
    try {
      const resp = await fetch('data/dict-5000.json');
      this.data = await resp.json();
    } catch {
      this.data = {};
    }
  },

  // Load exam words data
  async loadExamData() {
    if (this.examWords) return;
    try {
      const [wordsResp, freqResp] = await Promise.all([
        fetch('data/exam-words.json'),
        fetch('data/exam-frequency.json')
      ]);
      this.examWords = await wordsResp.json();
      this.examFreq = await freqResp.json();
    } catch {
      this.examWords = {};
      this.examFreq = {};
    }
  },

  // Get stem forms of a word (simple stemming)
  getStemForms(word) {
    const forms = [word];
    const w = word.toLowerCase();

    // Plural forms
    if (w.endsWith('ies') && w.length > 4) {
      forms.push(w.slice(0, -3) + 'y');  // cities → city
    }
    if (w.endsWith('es') && w.length > 3) {
      forms.push(w.slice(0, -2));          // experiences → experienc
      forms.push(w.slice(0, -1));          // experiences → experience
    }
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) {
      forms.push(w.slice(0, -1));          // books → book
    }

    // Past tense
    if (w.endsWith('ed') && w.length > 4) {
      forms.push(w.slice(0, -2));          // walked → walk
      forms.push(w.slice(0, -1));          // walked → walke
    }

    // Progressive forms
    if (w.endsWith('ing') && w.length > 5) {
      forms.push(w.slice(0, -3));          // running → runn
      forms.push(w.slice(0, -3) + 'e');    // making → make
      forms.push(w.slice(0, -4));          // getting → get
    }

    // Adverb forms
    if (w.endsWith('ly') && w.length > 4) {
      forms.push(w.slice(0, -2));          // quickly → quick
    }

    // Comparative/superlative
    if (w.endsWith('er') && w.length > 4) {
      forms.push(w.slice(0, -2));          // bigger → bigg
      forms.push(w.slice(0, -1));          // bigger → bigger
    }
    if (w.endsWith('est') && w.length > 5) {
      forms.push(w.slice(0, -3));          // biggest → bigg
    }

    // Noun forms
    if (w.endsWith('tion')) {
      forms.push(w.slice(0, -4) + 'te');   // education → educate
    }
    if (w.endsWith('ment') && w.length > 5) {
      forms.push(w.slice(0, -4));          // development → develop
    }
    if (w.endsWith('ness') && w.length > 5) {
      forms.push(w.slice(0, -4));          // happiness → happi
    }

    // Adjective forms
    if (w.endsWith('able') && w.length > 5) {
      forms.push(w.slice(0, -4));          // readable → read
    }
    if (w.endsWith('ful') && w.length > 4) {
      forms.push(w.slice(0, -3));          // beautiful → beauti
    }

    return [...new Set(forms)];
  },

  // Look up a word (tries local, online API, then AI)
  async lookup(word) {
    const key = word.toLowerCase().replace(/[^a-z\-']/g, '');
    if (!key || key.length < 2) {
      return { word, phonetic: '', translation: '无效单词', found: false };
    }

    // Check cache
    if (this.cache.has(key)) return this.cache.get(key);

    await this.load();
    await this.loadExamData();

    // Get exam data for this word
    const examData = this.getExamData(key);

    // 1. Try local dictionary (with stemming)
    const forms = this.getStemForms(key);
    for (const form of forms) {
      if (this.data[form]) {
        const d = this.data[form];
        // 生成 Free Dictionary API 音频 URL（已知格式）
        const audioUrl = `https://api.dictionaryapi.dev/media/pronunciations/en/${key}-uk.mp3`;
        const result = {
          word: key,
          baseForm: form !== key ? form : undefined,
          phonetic: d.p || '',
          translation: d.t || key,
          pos: '',
          audioUrl,
          found: true,
          source: 'local',
          ...examData
        };
        this.cache.set(key, result);
        return result;
      }
    }

    // 2. Try Free Dictionary API (includes audio URLs)
    try {
      const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`);
      if (resp.ok) {
        const data = await resp.json();
        const entry = data[0];
        const phonetic = entry.phonetic || (entry.phonetics.find(p => p.text) || {}).text || '';
        const meanings = entry.meanings || [];

        // Get audio URL (prefer US/UK pronunciation, fallback to any)
        let audioUrl = '';
        if (entry.phonetics) {
          const usAudio = entry.phonetics.find(p => p.audio && (p.audio.includes('-us') || p.audio.includes('-uk')));
          const auAudio = entry.phonetics.find(p => p.audio && p.audio.includes('-au'));
          const anyAudio = entry.phonetics.find(p => p.audio && p.audio.length > 0);
          audioUrl = (usAudio || auAudio || anyAudio)?.audio || '';
        }

        let translation = '';
        if (meanings.length > 0) {
          const defs = meanings[0].definitions || [];
          if (defs.length > 0) translation = defs[0].definition;
        }

        const result = {
          word: key,
          phonetic,
          translation: translation || key,
          pos: meanings[0]?.partOfSpeech || '',
          audioUrl,
          found: true,
          source: 'api',
          ...examData
        };
        this.cache.set(key, result);
        return result;
      }
    } catch {}

    // 3. Try AI translation
    const aiTranslation = await API.translateWord(key);
    const result = {
      word: key,
      phonetic: '',
      translation: aiTranslation,
      pos: '',
      audioUrl: '',
      found: true,
      source: 'ai',
      ...examData
    };
    this.cache.set(key, result);
    return result;
  },

  // Get exam level and frequency data for a word
  getExamData(word) {
    const w = word.toLowerCase();
    const levels = this.examWords?.[w] || [];

    // 词频判断逻辑：
    // 1. 在本地词典（高频5000词）中 → 高频
    // 2. 在考试词表中 → 中频
    // 3. 都不在 → 低频
    const forms = this.getStemForms(w);
    const inLocalDict = forms.some(f => this.data?.[f]);
    const inExamList = levels.length > 0;

    let freqLevel = 'low';
    if (inLocalDict) {
      freqLevel = 'high';  // 本地词典收录的都是高频词
    } else if (inExamList) {
      freqLevel = 'medium';  // 考试词表里的词是中频
    }

    return {
      examLevels: levels,
      freqLevel: freqLevel
    };
  }
};
