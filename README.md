# AI 英语阅读助手

一款基于 AI 的英语阅读学习工具，支持生成个性化英语文章、单词翻译、句子分析等功能。

## 功能特性

### 核心功能
- **AI 文章生成**：根据话题、难度、关键词生成英语阅读文章
- **点击查词**：单击任意单词显示翻译、音标、词性
- **段落翻译**：每段英文后有「译」按钮，点击查看中文翻译
- **全文翻译**：一键显示/隐藏所有段落的中文翻译
- **句子分析**：长按选中句子，AI 分析语法结构、翻译、仿写练习

### 学习功能
- **生词本**：收藏单词，支持复习卡片模式
- **学习词库**：导入学过的单词，AI 生成文章时自动融入
- **智能复习**：生成文章时自动使用学习词库中的单词
- **词根去重**：running/runs/ran 自动识别为同一词根

### 设置选项
- **6 级难度**：四级/六级/考研 × 易/难
- **预设话题**：科技、新闻、教育、健康等 12 个话题
- **暗黑模式**：支持亮色/暗色主题切换
- **对话历史**：聊天记录自动保存

### 发音功能
- **真人发音**：使用 Free Dictionary API 的真人录音
- **多级降级**：真人录音 → Google TTS → 设备 TTS

## 技术栈

- **前端**：HTML + CSS + JavaScript（无框架）
- **数据库**：IndexedDB（浏览器内置）
- **AI API**：DeepSeek（兼容 OpenAI 协议）
- **打包**：Capacitor → Android APK
- **词典**：ECDICT 精简版（~1.1MB，19000+ 词）

## 安装使用

### 方式一：下载 APK
1. 从 Releases 页面下载最新 APK
2. 在 Android 手机上安装
3. 首次打开输入 DeepSeek API Key

### 方式二：源码运行
```bash
# 克隆仓库
git clone https://github.com/ww-reasure/english-reader-app.git
cd english-reader-app

# 安装依赖
npm install

# 本地运行（浏览器）
# 直接打开 index.html 或用 Live Server

# 构建 APK
npx cap sync android
cd android && ./gradlew assembleDebug
```

## API Key 获取

1. 访问 [DeepSeek 开放平台](https://platform.deepseek.com/)
2. 注册账号并创建 API Key
3. 在 app 设置中输入 Key

## 项目结构

```
├── index.html              # SPA 入口
├── css/style.css           # 样式
├── js/                     # JavaScript 源码
│   ├── helpers.js          # 公共工具函数
│   ├── config.js           # 配置管理
│   ├── db.js               # IndexedDB 数据库
│   ├── api.js              # DeepSeek API 调用
│   ├── dictionary.js       # 词典查询
│   ├── theme.js            # 暗黑模式
│   ├── tts.js              # 语音发音
│   ├── router.js           # 前端路由
│   ├── app.js              # 应用入口
│   ├── components/         # UI 组件
│   │   ├── modal.js
│   │   ├── tooltip.js
│   │   └── ai-analysis.js
│   └── views/              # 页面视图
│       ├── chat.js
│       ├── reading.js
│       ├── history.js
│       ├── vocabulary.js
│       ├── flashcard.js
│       ├── learn-words.js
│       └── settings.js
├── data/
│   └── dict-5000.json      # 精简词典
├── android/                 # Capacitor Android 项目
├── package.json
├── capacitor.config.json
├── LICENSE
└── README.md
```

## 开发指南

### 添加新功能
1. 在 `js/views/` 创建新视图
2. 在 `js/router.js` 添加路由
3. 在 `index.html` 添加 script 标签
4. 在 `css/style.css` 添加样式

### 构建 APK
```bash
# 同步到 Android 项目
npx cap sync android

# 构建 debug APK
cd android && ./gradlew assembleDebug

# APK 位置
# android/app/build/outputs/apk/debug/app-debug.apk
```

## License

[MIT License](LICENSE)

## 致谢

- [DeepSeek](https://deepseek.com/) - AI API 服务
- [Free Dictionary API](https://dictionaryapi.dev/) - 单词发音
- [ECDICT](https://github.com/skywind3000/ECDICT) - 英汉词典数据
- [Capacitor](https://capacitorjs.com/) - 跨平台打包框架
