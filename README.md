# AI 英语阅读助手

一款基于 AI 的英语阅读学习工具，支持生成个性化文章、单词复习、句子分析等功能。适合大学生备考四六级/考研。

## 功能特性

### 阅读
- **AI 文章生成**：选择话题和难度，一键生成英语阅读文章
- **随机生成**：不输入内容直接点生成，自动随机话题
- **点击查词**：单击任意单词显示翻译、音标、词频等级
- **段落翻译**：每段英文后有「译」按钮，点击查看中文翻译
- **句子分析**：长按选中句子，AI 分析语法、翻译、仿写练习
- **阅读计时**：自动计时，统计阅读速度（词/分），支持暂停
- **文章收藏**：收藏喜欢的文章，方便回顾

### 单词
- **生词本**：阅读时收藏单词，支持点击查看详情（发音+词根+例句）
- **学习词库**：导入单词，AI 生成文章时自动融入帮助复习
- **间隔重复**：SM-2 算法调度复习，1天→3天→6天→递增
- **复习卡片**：翻转卡片式复习，支持词根拆解、记忆法、例句
- **词根去重**：running/runs/ran 自动识别为同一词根
- **单词发音**：Free Dictionary API 真人发音，支持英/美/澳多种口音

### 分析
- **阅读统计**：阅读次数、速度趋势、连续天数、查词统计
- **阅读报告**：周/月报告，成就系统，薄弱词识别
- **水平测评**：首次使用引导测评，推荐合适难度

### 其他
- **暗黑模式**：亮色/暗色主题切换
- **文章导入**：支持粘贴文本或上传 PDF 导入文章
- **单词导入**：批量导入单词到学习词库
- **对话历史**：聊天记录自动保存

## 技术栈

- **前端**：ES Modules + CSS Variables（无框架）
- **数据库**：IndexedDB
- **AI API**：DeepSeek（兼容 OpenAI 协议）
- **打包**：Vite + Capacitor → Android APK
- **词典**：ECDICT 精简版（~5000 词）+ Free Dictionary API

## 安装使用

### 使用内部构建
1. 从私有仓库或内部交付渠道获取 QA APK
2. 在 Android 手机上安装
3. 首次打开输入 DeepSeek API Key

### 源码运行
```bash
git clone https://github.com/ww-reasure/english-reader-private.git
cd english-reader-private
npm install
npx vite build          # 构建到 www/
npx cap sync android    # 同步到 Android
cd android && ./gradlew assembleDebug  # 构建 APK
```

浏览器调试：`npx serve .` 然后访问 `http://localhost:3000`

## API Key 获取

1. 访问 [DeepSeek 开放平台](https://platform.deepseek.com/)
2. 注册账号 → 充值 → 创建 API Key
3. 在 app 设置中输入 Key（Flash 模型每篇约 ¥0.01）

## 项目结构

```
├── index.html                # SPA 入口
├── css/style.css             # 样式（CSS Variables）
├── src/                      # ES Modules 源码
│   ├── app.js                # 应用入口
│   ├── router.js             # Hash 路由
│   ├── helpers.js            # 工具函数
│   ├── config.js             # 配置管理
│   ├── db.js                 # IndexedDB
│   ├── api.js                # DeepSeek API
│   ├── dictionary.js         # 词典查询
│   ├── theme.js              # 暗黑模式
│   ├── audio-cache.js        # 音频缓存
│   ├── spaced-repetition.js  # SM-2 算法
│   ├── affixes.js            # 词根分析
│   ├── examples.js           # 例句生成
│   ├── components/           # UI 组件
│   │   ├── modal.js
│   │   ├── tooltip.js
│   │   └── ai-analysis.js
│   └── views/                # 页面视图
│       ├── chat.js
│       ├── reading.js
│       ├── history.js
│       ├── vocabulary.js
│       ├── flashcard.js
│       ├── learn-words.js
│       ├── settings.js
│       ├── stats.js
│       ├── report.js
│       └── assessment.js
├── public/data/              # 词典数据
│   ├── dict-5000.json
│   ├── exam-words.json
│   └── exam-frequency.json
├── android/                  # Capacitor Android 项目
├── vite.config.js
├── package.json
├── capacitor.config.json
├── version.json
├── LICENSE
└── README.md
```

## 版本号规则

- 小修复/优化：+0.0.1（如 1.3.0 → 1.3.1）
- 大功能更新：+0.1（如 1.3.0 → 1.4.0）

## License

本项目为私有专有软件，不采用 MIT、Apache、GPL 等开源许可证。除获得版权所有者书面授权外，
不得复制、修改、分发或将本项目用于其他项目。完整条款见 [LICENSE](LICENSE)。

第三方依赖、字体、词典数据和外部数据源仍受其各自许可证和署名要求约束。

## 致谢

- [DeepSeek](https://deepseek.com/) - AI API 服务
- [Free Dictionary API](https://dictionaryapi.dev/) - 单词发音
- [ECDICT](https://github.com/skywind3000/ECDICT) - 英汉词典数据
- [Capacitor](https://capacitorjs.com/) - 跨平台打包框架
- [Vite](https://vitejs.dev/) - 构建工具
