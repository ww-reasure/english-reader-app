# 计时阅读功能设计

> 日期：2026-06-07
> 目标：将限时阅读改为计时阅读，完成后弹出总结

## 设计方案

### 核心改动

将 CountdownTimer（倒计时）改为 ReadingTimer（正计时 + 防空闲）。

### 流程

```
阅读页面加载
    ↓
工具栏显示：[▶ 开始计时]
    ↓
点击开始 → 按钮变为 [✓ 阅读完成]
    ↓
实时显示：已用时间 + 当前 WPM
    ↓
30秒无操作 → 自动暂停 → 触摸恢复
    ↓
点击「阅读完成」→ 弹出总结弹窗
```

### 总结弹窗内容

| 项 | 说明 |
|----|------|
| ⏱ 用时 | 格式化时间（排除空闲） |
| 📖 速度 | WPM（词/分钟） |
| 📈 历史平均 | 与之前阅读对比 |
| ⬆️/⬇️ 进步 | 百分比变化 |
| 🔍 查词数 | 本篇点击查了几个词 |
| 查词列表 | 显示查过的单词（可点击） |
| [加入词库复习] | 将查词加入 SRS |
| [生成巩固阅读] | 用查词生成文章 |
| [关闭] | 关闭弹窗 |

### 数据结构

readingStats 表（IndexedDB）：

```javascript
{
  id: auto,
  articleId: 123,
  wordCount: 300,
  elapsed: 222,           // 实际秒数（排除空闲）
  wpm: 81,                // 词/分钟
  clickCount: 5,          // 查词数
  clickedWords: ['elaborate', 'subsequent', ...],
  createdAt: timestamp
}
```

### 改动文件

| 文件 | 改动 |
|------|------|
| helpers.js | 删除 CountdownTimer，新增 ReadingTimer |
| views/reading.js | 重写计时逻辑 + 总结弹窗 |
| db.js | 新增 readingStats 表 |
| css/style.css | 总结弹窗样式 |

### 实施步骤

1. helpers.js — 新增 ReadingTimer 类
2. db.js — 新增 readingStats 表（DB v5）
3. views/reading.js — 重写工具栏 + 计时逻辑
4. views/reading.js — 总结弹窗
5. views/reading.js — 查词追踪（记录点击了哪些词）
6. css/style.css — 总结弹窗样式
7. 构建测试
