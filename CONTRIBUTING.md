# 内部开发说明

本仓库为私有项目，不接受公开贡献、Fork、Pull Request 或外部 Issue。
代码、文档和构建产物仅限版权所有者及获授权的协作者使用。

## 内部变更流程

1. 通过私有仓库协作渠道登记问题和需求。
2. 在独立分支或专属 worktree 中修改并完成测试。
3. 通过内部审查后合并到专属主线。

如需在本地初始化工作区：
   ```bash
   git clone https://github.com/ww-reasure/english-reader-private.git
   ```

### 内部提交规范

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
git clone https://github.com/ww-reasure/english-reader-private.git
cd english-reader-private

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

问题和变更请通过私有协作渠道处理，不通过公开 Issue 或 Discussion 处理。
