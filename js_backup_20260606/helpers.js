/**
 * Common Helper Functions
 * Shared utilities used across modules
 */

// HTML escape to prevent XSS
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// Escape string for use in JavaScript strings
function escJs(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

// Difficulty level labels
const DIFFICULTY_LABELS = {
  cet4: '四级',
  cet6: '六级',
  graduate: '考研'
};

// Format timestamp to locale string
function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN');
}

// Debounce function
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Shuffle array (Fisher-Yates)
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Irregular verb/adjective mappings (high frequency)
const IRREGULAR_MAP = {
  'ran': 'run', 'been': 'be', 'was': 'be', 'were': 'be',
  'went': 'go', 'gone': 'go', 'came': 'come', 'became': 'become',
  'began': 'begin', 'broken': 'break', 'brought': 'bring',
  'bought': 'buy', 'caught': 'catch', 'chose': 'choose',
  'done': 'do', 'did': 'do', 'drank': 'drink', 'driven': 'drive',
  'eaten': 'eat', 'fell': 'fall', 'fallen': 'fall', 'felt': 'feel',
  'found': 'find', 'flew': 'fly', 'flown': 'fly', 'forgot': 'forget',
  'forgotten': 'forget', 'got': 'get', 'gotten': 'get', 'gave': 'give',
  'given': 'give', 'grown': 'grow', 'had': 'have',
  'heard': 'hear', 'held': 'hold', 'kept': 'keep', 'knew': 'know',
  'known': 'know', 'laid': 'lay', 'led': 'lead', 'left': 'leave',
  'lent': 'lend', 'let': 'let', 'lost': 'lose', 'made': 'make',
  'meant': 'mean', 'met': 'meet', 'paid': 'pay', 'put': 'put',
  'read': 'read', 'rode': 'ride', 'ridden': 'ride', 'rang': 'ring',
  'rung': 'ring', 'rose': 'rise', 'risen': 'rise', 'said': 'say',
  'seen': 'see', 'sent': 'send', 'set': 'set', 'shown': 'show',
  'sang': 'sing', 'sung': 'sing', 'sat': 'sit', 'slept': 'sleep',
  'spoke': 'speak', 'spoken': 'speak', 'spent': 'spend', 'stood': 'stand',
  'taken': 'take', 'taught': 'teach', 'told': 'tell', 'thought': 'think',
  'understood': 'understand', 'woke': 'wake', 'woken': 'wake',
  'wore': 'wear', 'worn': 'wear', 'won': 'win', 'wrote': 'write',
  'written': 'write', 'worse': 'bad', 'worst': 'bad', 'better': 'good', 'best': 'good'
};

// Get stem/base form of a word for deduplication
function getStemForm(word) {
  const w = word.toLowerCase().trim();

  // Check irregular forms first
  if (IRREGULAR_MAP[w]) return IRREGULAR_MAP[w];

  // Rule-based stemming
  // Plural: -ies → -y
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  // Plural: -es → remove
  if (w.endsWith('es') && w.length > 3) return w.slice(0, -2);
  // Plural: -s → remove
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  // Past: -ied → -y
  if (w.endsWith('ied') && w.length > 4) return w.slice(0, -3) + 'y';
  // Past: -ed → remove
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  // Progressive: -ying → -ie
  if (w.endsWith('ying') && w.length > 5) return w.slice(0, -4) + 'ie';
  // Progressive: -ing → remove (handle double consonant)
  if (w.endsWith('ing') && w.length > 5) {
    const base = w.slice(0, -3);
    // running → run (double consonant)
    if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
      return base.slice(0, -1);
    }
    return base;
  }
  // Adverb: -ly → remove
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);
  // Comparative: -er → remove
  if (w.endsWith('er') && w.length > 4) return w.slice(0, -2);
  // Superlative: -est → remove
  if (w.endsWith('est') && w.length > 5) return w.slice(0, -3);
  // Noun: -tion → -te
  if (w.endsWith('tion') && w.length > 5) return w.slice(0, -4) + 'te';
  // Noun: -ment → remove
  if (w.endsWith('ment') && w.length > 5) return w.slice(0, -4);
  // Noun: -ness → remove
  if (w.endsWith('ness') && w.length > 5) return w.slice(0, -4);
  // Adjective: -able → remove
  if (w.endsWith('able') && w.length > 5) return w.slice(0, -4);
  // Adjective: -ful → remove
  if (w.endsWith('ful') && w.length > 4) return w.slice(0, -3);

  return w;
}
