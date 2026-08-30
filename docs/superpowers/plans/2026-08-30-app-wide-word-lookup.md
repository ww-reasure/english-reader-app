# App 内统一点词翻译与句子分析布局：执行记录

日期：2026-08-30

分支：`feat/app-wide-word-lookup`

基线：`fa02328 feat: complete performance reliability and tablet baseline`

## 已完成

- 建立本地基线提交并从基线创建功能分支；未推送远程。
- 以 `bindLearningTextLookup()` 统一 App 内学习文本查词，并保留 `bindReadingStyleWordLookup()` 兼容入口。
- 普通学习文本使用单击；真题英文选项使用 450 ms 长按、12 px 移动取消，并只抑制长按后的单次选择点击。
- 通过声明式 `data-learning-text` / `data-word-lookup` 控制范围，不为长文章逐词创建 DOM，也不覆盖按钮、链接、输入区、中文翻译、代码块和普通聊天消息。
- 阅读、AI 分析、闪卡、语境复习、单词详情、测评、真题和首页导学已接入共享委托与统一清理。
- Tooltip 增加 compact/full 密度、本地首显、异步语境义、按需展开、失败重试和 revision 成员索引；失败不自动调用 AI。
- 修复 AI 分析布局：禁用该面板的通用伪元素装饰，删除空 Footer，使用 Header / Body / Composer 三行 Grid，Body 独立滚动。
- 首页只在导学卡出现时动态加载查词模块，减少普通首页的无效工作。
- Android 发布号更新到 `2.0.0 / versionCode 48`。

## RED / GREEN 证据

- 统一范围、控件排除、真题短按/长按、移动取消、迟到结果抑制、失败显式重试：RED 后 GREEN。
- revision 词库成员索引、compact 释义展开、错误卡重试按钮：RED 后 GREEN。
- AI 三段式布局、禁用 `.modal::before`、删除空 Footer、Composer 不再 sticky 覆盖正文：RED 后 GREEN。
- v48 发布契约：RED 后 GREEN。
- 全量中 3 个初始失败来自 Flashcard 行为测试加载器未映射新增依赖；只补依赖桩后 3/3 GREEN，未放宽业务断言。

## 最终自动验证

- 相关定向套件：83/83；新增重试套件：8/8；首页导学套件：17/17。
- 全量：1501 tests / 1484 pass / 0 fail / 17 skip。
- `git diff --check`：通过。
- public 构建：通过，不含私有题包。
- private-qa 构建：通过，保留 5 个授权/合成题包。
- 入口：274.80 kB raw / 81.15 kB gzip；相对基线增加约 25 kB raw / 8 kB gzip。
- 曾实验强制 manual chunk：入口表面下降但查词大块被入口 preload，总下载反而增加，已撤销。
- APK：`E:\play\claude\EnglishReader-private-qa-v2.0.0-48-debug.apk`；最终哈希在功能提交后重建并记录。

## 尚需真机完成

- 360×800、412×915、768×1024、1024×640，字体 100% / 130% / 150% 的真实矩形与滚动测量。
- 手机/平板浏览器与 Android WebView 冒烟、软键盘与旋转场景。
- 原因：本轮 Codex 内置浏览器控制运行时返回 `failed to write kernel assets: 系统找不到指定的路径`；未用推算结果冒充真实测量。
