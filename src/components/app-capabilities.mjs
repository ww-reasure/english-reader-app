export const APP_CAPABILITY_CATALOG_VERSION = 1;

const entries = Object.freeze([
  { id: 'learning_chat', name: '学习对话', category: '对话', route: '#/chat', summary: '询问词汇、语法、阅读策略并制定学习计划。', keywords: ['对话', '问答', '计划'], prerequisites: [], limitations: ['不会自动替用户执行学习任务'] },
  { id: 'generate_reading', name: '定制阅读', category: '阅读', route: '#/chat', summary: '按目标考试、材料压力和学习数据生成可点击阅读卡片。', keywords: ['生成', '文章', '阅读'], prerequisites: ['已设置 AI API Key', '已选择目标考试'], limitations: ['必须由当前用户明确要求生成'] },
  { id: 'review_reading', name: '复习阅读', category: '阅读', route: '#/chat', summary: '把今日薄弱词自然放入文章中巩固。', keywords: ['薄弱词', '复习阅读'], prerequisites: ['存在已复习词'], limitations: ['生成结果以阅读卡片交付'] },
  { id: 'reading_library', name: '我的书架', category: '阅读', route: '#/reading-list', summary: '按难度和题材浏览本地及云端文章。', keywords: ['书架', '文章', '筛选'], prerequisites: [], limitations: [] },
  { id: 'sentence_guide', name: '逐句导读', category: '阅读', route: '#/reading-list', summary: '在文章中逐句查看断句、意译、语法和重点词。', keywords: ['逐句', '导读', '语法'], prerequisites: ['先打开一篇文章'], limitations: ['只分析当前句'] },
  { id: 'word_lookup', name: '点词学习', category: '词汇', route: '#/reading-list', summary: '阅读时点词查看本句义、常用释义、发音并收藏。', keywords: ['点词', '翻译', '本句义'], prerequisites: ['先打开一篇文章'], limitations: [] },
  { id: 'vocabulary', name: '词汇学习', category: '词汇', route: '#/vocab', summary: '管理收藏词和学习词库，查看完整学习详情。', keywords: ['词汇', '生词', '收藏'], prerequisites: [], limitations: [] },
  { id: 'word_review', name: '单词回忆', category: '复习', route: '#/flashcard/recall', summary: '脱离语境看词回忆释义，按认识、模糊、忘了评分。', keywords: ['复习', '单词', '回忆'], prerequisites: ['存在到期学习词'], limitations: ['直接回忆证据强于语境识词'] },
  { id: 'context_review', name: '语境识词', category: '复习', route: '#/flashcard/context', summary: '在英文句子中判断到期单词，先作答再显示本句义。', keywords: ['复习', '语境', '例句', '识词'], prerequisites: ['存在到期学习词'], limitations: ['语境认识只形成较弱的正向证据'] },
  { id: 'calibration', name: '3 分钟阅读校准', category: '档案', route: '#/assessment', summary: '用 24 道分层词义题和短阅读推荐材料压力。', keywords: ['校准', '测评', '难度'], prerequisites: ['选择目标考试'], limitations: ['不估算虚假词汇量'] },
  { id: 'learning_profile', name: '学习档案', category: '档案', route: '#/profile', summary: '查看有效阅读、阅读时长、速度和复习概览。', keywords: ['档案', '统计', '进度'], prerequisites: [], limitations: ['只统计达到有效阅读门槛的阅读'] },
  { id: 'exam_training', name: '真题训练', category: '真题', route: '#/exam', summary: '选择整卷或专项进行考研英语一真题训练。', keywords: ['真题', '训练', '做题'], prerequisites: ['已安装真题题包'], limitations: ['必须由用户点击后开始'] },
  { id: 'exam_review', name: '错题复习', category: '真题', route: '#/exam/review', summary: '查看到期错题与翻译复习安排。', keywords: ['错题', '复习', '真题'], prerequisites: ['存在复习记录'], limitations: ['不会自动开始复习'] },
  { id: 'exam_history', name: '真题记录', category: '真题', route: '#/exam/history', summary: '查看已提交和进行中的真题练习。', keywords: ['真题', '记录', '历史'], prerequisites: [], limitations: [] },
  { id: 'learning_report', name: '学习报告', category: '档案', route: '#/report', summary: '查看阶段阅读与词汇复习报告。', keywords: ['报告', '周报', '总结'], prerequisites: [], limitations: [] },
  { id: 'settings', name: '学习设置', category: '设置', route: '#/settings', summary: '设置目标考试、材料压力、主题和 AI 服务。', keywords: ['设置', '目标', '难度'], prerequisites: [], limitations: [] }
]);

const normalize = value => String(value || '').trim().toLocaleLowerCase('zh-CN');
const publicEntry = entry => ({
  id: entry.id,
  name: entry.name,
  category: entry.category,
  route: entry.route,
  summary: entry.summary,
  prerequisites: [...entry.prerequisites],
  limitations: [...entry.limitations]
});

export const AppCapabilityRegistry = Object.freeze({
  all() {
    return entries.map(publicEntry);
  },

  get(id) {
    const entry = entries.find(item => item.id === id);
    return entry ? publicEntry(entry) : null;
  },

  search({ query = '', ids = [] } = {}) {
    const selectedIds = new Set((Array.isArray(ids) ? ids : []).map(normalize).filter(Boolean));
    const needle = normalize(query);
    return entries
      .filter(entry => {
        if (selectedIds.size && selectedIds.has(normalize(entry.id))) return true;
        if (!needle) return !selectedIds.size;
        return normalize([entry.id, entry.name, entry.category, entry.summary, ...entry.keywords].join(' ')).includes(needle);
      })
      .map(publicEntry);
  },

  compactIndex() {
    return entries.map(entry => `${entry.id}｜${entry.name}：${entry.summary}`).join('\n');
  }
});

export function createCapabilityActionArtifact(actions = []) {
  const safe = [];
  for (const candidate of Array.isArray(actions) ? actions : []) {
    if (safe.length >= 3) break;
    const capability = AppCapabilityRegistry.get(candidate?.capabilityId);
    if (!capability || safe.some(item => item.capabilityId === capability.id)) continue;
    const label = String(candidate?.label || capability.name).trim().slice(0, 24) || capability.name;
    safe.push({ capabilityId: capability.id, label, route: capability.route });
  }
  return { type: 'app_actions', actions: safe };
}

export const APP_CAPABILITY_TOOLS = Object.freeze([
  {
    type: 'function',
    function: {
      name: 'get_app_capabilities',
      description: '按用户目标查询 App 的真实功能、入口、前置条件和限制。制定计划或推荐入口时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '功能或学习目标关键词' },
          ids: { type: 'array', items: { type: 'string' }, maxItems: 6 }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'offer_app_actions',
      description: '在回答下方提供最多三个需要用户亲自点击的 App 功能入口。不得借此自动开始任务。',
      parameters: {
        type: 'object',
        required: ['actions'],
        properties: {
          actions: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              required: ['capabilityId'],
              properties: {
                capabilityId: { type: 'string' },
                label: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }
]);
