# 开发文档

技术架构、开发环境搭建、构建流程说明。

## 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| 前端 | HTML + CSS + JavaScript | 无框架，原生开发 |
| 数据库 | IndexedDB | 浏览器内置，无需服务器 |
| AI API | DeepSeek | 兼容 OpenAI 协议 |
| 词典 | ECDICT 精简版 | 19000+ 高频词 |
| 打包 | Capacitor | 跨平台移动应用框架 |
| 构建 | Gradle | Android 构建工具 |

## 项目结构

```
├── index.html              # SPA 入口
├── css/style.css           # 全局样式
├── js/                     # JavaScript 源码
│   ├── helpers.js          # 公共工具函数（esc、debounce、shuffleArray、词根化）
│   ├── config.js           # 配置管理（localStorage 封装）
│   ├── db.js               # IndexedDB 数据库封装
│   ├── api.js              # DeepSeek API 调用（6 级难度 prompt）
│   ├── dictionary.js       # 词典查询（本地 → Free Dictionary API → AI）
│   ├── theme.js            # 暗黑模式管理
│   ├── tts.js              # 语音发音（真人录音 → Google TTS → 设备 TTS）
│   ├── router.js           # 前端路由（hash 路由）
│   ├── app.js              # 应用入口（初始化 + 全局事件）
│   ├── components/         # UI 组件
│   │   ├── modal.js        # 弹窗管理（API 设置、文章导入）
│   │   ├── tooltip.js      # 单词翻译弹窗
│   │   └── ai-analysis.js  # AI 句子分析
│   └── views/              # 页面视图
│       ├── chat.js         # 对话页面（生成文章、导入单词）
│       ├── reading.js      # 阅读页面（查词、翻译、发音）
│       ├── history.js      # 历史记录页面
│       ├── vocabulary.js   # 生词本页面
│       ├── flashcard.js    # 复习卡片页面
│       ├── learn-words.js  # 学习词库页面
│       └── settings.js     # 设置页面
├── data/
│   └── dict-5000.json      # 精简词典（19000+ 词，1.1MB）
├── android/                # Capacitor Android 项目
│   ├── app/src/main/java/  # Java 源码
│   │   ├── MainActivity.java
│   │   └── TtsBridge.java  # Android 原生 TTS 桥接
│   ├── build.gradle
│   └── ...
├── package.json            # npm 配置
├── capacitor.config.json   # Capacitor 配置
├── LICENSE                 # MIT 协议
├── README.md               # 项目说明
├── CHANGELOG.md            # 更新日志
└── docs/                   # 文档目录
    ├── DEVELOPMENT.md      # 开发文档（本文件）
    └── FEATURES.md         # 功能说明
```

## 开发环境搭建

### 前置要求

- Node.js 18+
- Android Studio（如需构建 APK）
- Git

### 本地运行

```bash
# 克隆仓库
git clone https://github.com/ww-reasure/english-reader-app.git
cd english-reader-app

# 安装依赖
npm install

# 本地运行
# 方式1：用浏览器直接打开 index.html
# 方式2：用 VS Code Live Server 插件
# 方式3：用 Python 简单服务器
python -m http.server 8080
```

### 构建 APK

```bash
# 同步到 Android
npx cap sync android

# 构建 debug APK
cd android && ./gradlew assembleDebug

# APK 位置
# android/app/build/outputs/apk/debug/app-debug.apk
```

## 核心模块说明

### 1. 配置管理 (config.js)

使用 localStorage 存储用户配置：

```javascript
const Config = {
  defaults: {
    api_key: '',
    base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    theme: 'light'
  },
  get(key) { ... },
  set(key, value) { ... },
  hasApiKey() { ... }
};
```

### 2. 数据库 (db.js)

IndexedDB 封装，三个表：

- **articles**：文章存储（id, title, content, translation, difficulty, topic, wordCount, createdAt）
- **vocabulary**：生词本（id, word, phonetic, translation, contextSentence, createdAt）
- **learnWords**：学习词库（id, word, createdAt）— 使用词根去重

### 3. API 调用 (api.js)

6 级难度 prompt 系统：

```javascript
const DIFFICULTY_RULES = {
  'cet4_easy': '...',
  'cet4_hard': '...',
  'cet6_easy': '...',
  'cet6_hard': '...',
  'graduate_easy': '...',
  'graduate_hard': '...'
};
```

### 4. 词典查询 (dictionary.js)

三层查询策略：

1. **本地词典**：dict-5000.json（19000+ 词，含词根还原）
2. **Free Dictionary API**：在线查询 + 真人发音
3. **AI 翻译**：兜底方案

### 5. 语音发音 (tts.js)

三级降级策略：

1. **真人录音**：Free Dictionary API 音频 URL
2. **Google TTS**：在线合成
3. **设备 TTS**：Android 原生 TTS（通过 TtsBridge 桥接）

## 代码规范

- 使用 2 空格缩进
- 函数和变量使用驼峰命名
- 添加必要的注释
- 每个模块使用对象命名空间（如 `Config`、`DB`、`API`）
- 异步操作使用 async/await

## 调试技巧

### 浏览器调试

1. 打开 `index.html`
2. F12 打开开发者工具
3. Console 查看日志
4. Application → IndexedDB 查看数据

### Android 调试

1. 手机开启 USB 调试
2. Chrome 打开 `chrome://inspect`
3. 选择设备，打开 DevTools

## 常见问题

### Q: 生成文章失败？
A: 检查 API Key 是否正确，网络是否正常。

### Q: 发音没有声音？
A: 需要联网（使用在线真人发音），或检查手机音量设置。

### Q: 本地词典查不到单词？
A: 会自动使用 Free Dictionary API 在线查询，再不行会用 AI 翻译。

---

更多问题请查看 [Issues](https://github.com/ww-reasure/english-reader-app/issues)。
