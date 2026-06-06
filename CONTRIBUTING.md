# 贡献指南

感谢你对本项目的关注！欢迎任何形式的贡献。

## 如何贡献

### 报告问题

1. 在 [Issues](https://github.com/ww-reasure/english-reader-app/issues) 页面创建新 Issue
2. 使用 Bug 报告模板
3. 尽可能详细地描述问题

### 提交代码

1. **Fork** 本仓库
2. **克隆**你的 Fork：
   ```bash
   git clone https://github.com/ww-reasure/english-reader-app.git
   ```
3. **创建分支**：
   ```bash
   git checkout -b feature/你的功能名
   ```
4. **修改代码**
5. **测试**：确保功能正常
6. **提交**：
   ```bash
   git add .
   git commit -m "feat: 添加xxx功能"
   ```
7. **推送**：
   ```bash
   git push origin feature/你的功能名
   ```
8. **创建 Pull Request**

### 提交规范

使用语义化提交信息：

- `feat:` 新功能
- `fix:` 修复问题
- `docs:` 文档更新
- `style:` 代码格式调整
- `refactor:` 重构
- `test:` 测试相关
- `chore:` 构建/工具相关

示例：
```
feat: 添加单词发音功能
fix: 修复长按选句不弹出按钮的问题
docs: 更新 README 安装说明
```

## 开发环境

### 前置要求

- Node.js 18+
- Android Studio（如需构建 APK）

### 本地运行

```bash
# 克隆仓库
git clone https://github.com/ww-reasure/english-reader-app.git
cd english-reader-app

# 安装依赖
npm install

# 本地运行
# 用浏览器直接打开 index.html
# 或使用 VS Code Live Server 插件
```

### 构建 APK

```bash
# 同步到 Android
npx cap sync android

# 构建
cd android && ./gradlew assembleDebug

# APK 位置
# android/app/build/outputs/apk/debug/app-debug.apk
```

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
│   └── views/              # 页面视图
├── data/dict-5000.json     # 精简词典
└── android/                # Capacitor Android 项目
```

## 代码规范

- 使用 2 空格缩进
- 函数和变量使用驼峰命名
- 添加必要的注释
- 保持代码简洁

## 联系方式

如有问题，可通过 Issue 或 Discussion 联系。

再次感谢你的贡献！🎉
