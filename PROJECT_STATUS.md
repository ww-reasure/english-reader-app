# English Reader main 线交接（2026-08-30 功能移植轮）

## 本轮结果

以开发线 `feat/english-practice-machine`（fa02328）为参考源，把全部非真题功能移植到 main 线。
main 从 1.9.4 前进到 **1.9.5（versionCode 41）**，共 9 个提交，工作树干净，未推送。

## 提交清单（自旧到新）

1. `0597d92` feat(infra)：诊断日志/导出、学习日与学习活动存储、学习计时器、发音解析、启动性能基线（TTS 延迟路径移除、fully drawn 桥）、v23 IndexedDB（完整迁移链，真题 store 保留空置以保证迁移连续）、平板 CSS 基线。
2. `e658dba` feat(router)：声明式路由表（无真题路由，#/learn-words 兼容重定向、not-found 壳）+ 导航生命周期控制器（骨架同步挂载、token 重查、同视图 render 串行化与代间 teardown、跟踪条目释放、四阶段隐私安全证据）。
3. `4435a09` feat(review)：durable journal 复习管线（损坏隔离、ID 严格校验、attemptId 幂等与 revision 重算）、最弱评级结果统计、V2 会话重插、专项练习（续练结果只计本次、整组进度累计）、结果页保存状态与重试、语境复习。含审查修复全部加固。
4. `2cfd9d1` feat(vocab)：统一词汇库、导入分析与恢复、PDF 导入、难度画像、词汇页重设计；learn-words.js 退役。
5. `9595185` feat(reading)：可恢复阅读进度、完成幂等与可重试清理、阅读活动统计（查词/收藏词）、导读与划词增强（真题选择器已清）。
6. `f6082ad` feat(agent)：多模态视觉聊天（图片持久化/预览）、分步互动教学、学习日报卡片与只读工具、学习者画像（provisional）、模型目录、composer 状态、资源压缩、联网研究。真题 provider 在 main 线为空存根（日报 exam 段恒空，schema 兼容）。
7. `bec1be5` test：移植实践线全部测试套件并裁剪真题断言（含 main 线发布工程契约裁剪说明）。
8. `4813508` feat(agent)：tooltip 与知识画像对齐收尾。
9. `faf9372` chore(release)：1.9.5 / versionCode 41。

## 验证基线（main 树实测）

- `node --test tests/*.test.mjs`：1228 项全部通过，0 失败，0 跳过。
- `npm run build`（public）：通过，43 chunks。
- `git diff --check`：干净。
- 真题残留：`src/`、`tests/` 中无 `views/exam-*`、`src/exam/*`、`exam-packs`、`exam-practice`、`exam-tutor` 引用；`css/style.css` 中遗留少量无 DOM 命中的真题样式块（死样式，无功能影响，可在后续清理）。
- `src/exam-corpus.mjs` / `exam-corpus-runtime.mjs` 保留 main 线旧版（单索引语料查询，供复习/词汇例句增强），并补了 `preload` 钩子。

## 范围与限制

- 真题训练（题包、练习、错题复习、翻译训练、真题学习概览、题包安装器与校验）按约定**不包含**；日报的 exam 事实段为恒空存根，schema 兼容。
- 开发线工作树中未提交的 WebView 启动实验（versionCode 46/47 的 build.gradle 开关等）**未移植**，仍留在 `feat/english-practice-machine` 工作树。
- DB 迁移链 v14→v23 为代码级移植；老用户数据（v14）升级前建议先备份实测一次。
- 未做任何远程推送；main 领先 origin/main 的提交数随本轮增加（此前 3 + 本轮 9）。
