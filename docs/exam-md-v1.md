# exam-md-v1 与 Exam Pack 设计

## 1. Markdown 源码格式

`exam-md-v1` 是人工/网页 AI 可读的题库源码格式，不是 App 运行时格式。

```markdown
# 2026 考研英语一

```exam-meta
{
  "schema": "exam-md-v1",
  "examId": "kaoyan_en1",
  "bankId": "builtin_kaoyan_en1",
  "packageId": "local.kaoyan.en1",
  "packageVersion": "1.0.0",
  "paperKey": "kaoyan_en1_2026",
  "year": 2026,
  "sourceType": "past_exam"
}
```

## 3.1 Section II Part C 翻译

翻译单元使用 `type: "translation"`，每个指定划线片段使用独立的
`type: "translation_segment"` question。`exam-item` 只保存稳定机器字段；正文和来源解析继续使用 Markdown headings。

```markdown
### Section II Part C

```exam-item
{
  "unitKey": "kaoyan_en1_2026_part_c",
  "type": "translation",
  "displayTitle": "Part C 翻译"
}
```

#### Directions
Read the following text carefully ...

#### Passage
##### P1
完整英文上下文。

#### Q46

```exam-item
{
  "questionKey": "kaoyan_en1_2026_part_c_q46",
  "segmentKey": "S46",
  "type": "translation_segment",
  "points": 2
}
```

##### Source Text
需要翻译的原文片段。

##### Reference Translation
来源提供的参考译文（可选）。

##### Local Analysis
来源提供的本地解析（可选）。

##### Location
P1
```

`translation_segment` 不使用 `answer`、`options` 或客观题正确/错误字段；用户译文在现有 `examResponses` 中以可选的 `value: { "text": "..." }` 保存。参考译文、解析和定位字段均可省略，缺失不导致 validation failure。

## 2. Reading unit

```markdown
## Section II Part A

### Text 1

```exam-item
{
  "unitKey": "kaoyan_en1_2026_part_a_text_1",
  "type": "reading_mcq",
  "displayTitle": "Text 1"
}
```

#### Directions
Read the passage and answer the questions.

#### Passage

##### P1
For thousands of years, ...

#### Passage Translation

##### P1
（中文，仅提交后允许显示）

#### Q21

```exam-item
{
  "questionKey": "kaoyan_en1_2026_q21",
  "type": "single_choice",
  "answer": "C",
  "points": 2
}
```

What can be learned ...?

- A. ...
- B. ...
- C. ...
- D. ...

##### Question Translation
...

##### Question Type
细节题

##### Stem Analysis
...

##### Location
P1

##### Evidence
...

##### Evidence Translation
...

##### Explanation
...

##### Option Translations
- A: ...
- B: ...
- C: ...
- D: ...

##### Option Analysis
- A: ...
- B: ...
- C: ...
- D: ...
```

## 3. Canonical JSON

Parser 只接受 fenced `exam-meta` / `exam-item` JSON 与固定 heading 层级，不猜测自然语言。

```json
{
  "schemaVersion": 1,
  "examId": "kaoyan_en1",
  "bankId": "builtin_kaoyan_en1",
  "packageId": "local.kaoyan.en1",
  "packageVersion": "1.0.0",
  "paperKey": "kaoyan_en1_2026",
  "year": 2026,
  "title": "2026 考研英语一",
  "sourceType": "past_exam",
  "units": [
    {
      "unitKey": "kaoyan_en1_2026_part_a_text_1",
      "type": "reading_mcq",
      "displayTitle": "Text 1",
      "directions": "Read the passage and answer the questions.",
      "passage": [{ "paragraphKey": "P1", "text": "..." }],
      "translation": [{ "paragraphKey": "P1", "text": "..." }],
      "questions": [
        {
          "questionKey": "kaoyan_en1_2026_q21",
          "type": "single_choice",
          "points": 2,
          "answer": "C",
          "stem": "...",
          "options": [{ "key": "A", "text": "..." }],
          "questionTranslation": "...",
          "questionType": "细节题",
          "stemAnalysis": "...",
          "location": "P1",
          "evidence": "...",
          "evidenceTranslation": "...",
          "explanation": "...",
          "optionTranslations": [{ "key": "A", "text": "..." }],
          "optionAnalysis": [{ "key": "A", "text": "..." }]
        }
      ]
    }
  ]
}
```

## 4. 稳定 ID

- `examId`：考试域，例如 `kaoyan_en1`、`cet4`。
- `bankId`：题库归属，例如 `builtin_kaoyan_en1`。`bankId` 必须在所有 pack 中全局唯一，同一银行升级版本时保持不变；不同考试或不同来源不得复用。
- `packageId`：发行包身份，例如 `local.kaoyan.en1`。
- `paperKey`：卷子身份，不能只使用年份，CET 同年多套必须区分。
- `unitKey`：单元身份。
- `questionKey`：题目身份；题库升级时内容可改，但 key 必须保持不变。

## 4.1 可选解析层字段

以下字段均为 optional；缺失时不会导致 parser 或 validator 失败：

- unit 下的 `#### Directions` → `unit.directions`，保存该练习单元的原始作答说明。
- question 下的 `##### Stem Analysis` → `question.stemAnalysis`，保存题干拆句/句法分析。
- question 下的 `##### Evidence Translation` → `question.evidenceTranslation`，保存英文定位句的中文翻译。
- question 下的 `##### Option Translations` → `question.optionTranslations`，使用 `- A: ...` 形式逐项保存选项翻译。

`optionTranslations` 可以只提供部分选项；每个 `key` 必须存在于该题的 `options`，且不得重复。上述字段不得把原文内容改写、总结或补造；没有可靠内容时应省略字段或按题库生产规范标记不确定性。

- ordering unit 下的 `#### Candidate Translations` → `unit.candidateTranslations`，使用 `- A: ...` 形式逐项保存候选段中文译文。

`candidateTranslations` 可以只提供部分候选段；每个 `key` 必须存在于同一 unit 的 `candidates[].candidateKey`，且不得重复。缺失该 optional 字段或缺少部分候选译文不会导致 validation failure。

`packageId` 只是内容配送/版本来源标识，不作为用户历史恢复所必需的语义身份；历史内容关联始终依赖 `bankId + paperKey/unitKey/questionKey`。

IndexedDB 内容记录使用合法字段 `contentId` 作为 keyPath，值为 `${bankId}:${paperKey|unitKey|questionKey}`；逻辑 key 仍单独保存并建索引。`questionKey` 必须在同一个 `bankId` 内全局唯一。

## 5. Exam Pack manifest

```json
{
  "schemaVersion": 1,
  "packageId": "local.kaoyan.en1",
  "packageVersion": "1.0.0",
  "examId": "kaoyan_en1",
  "bankId": "builtin_kaoyan_en1",
  "displayName": "考研英语一",
  "contentHash": "sha256:...",
  "generatedAt": "...",
  "papers": [
    {
      "paperKey": "kaoyan_en1_2026",
      "year": 2026,
      "path": "papers/kaoyan_en1_2026.json",
      "contentHash": "sha256:...",
      "unitCount": 1,
      "questionCount": 5
    }
  ]
}
```

## 6. Hash 与升级

- `contentHash` 是对稳定 JSON 序列化后的 SHA-256，序列化时对象 key 排序，数组顺序保留。
- `generatedAt` 不参与 hash，避免无内容变化时因时间戳导致内容不一致。
- 题目级 hash 用于未来 attempt 快照和“题库内容已更新”提示。
- 安装器比较 `packageId + packageVersion + contentHash`；相同则幂等跳过，不同则只替换该 package 的内容记录。
- 升级不得删除未来用户数据 store；attempts、错题、收藏和历史记录必须继续使用稳定 key 关联。

## 7. 完形填空 `cloze_choice`

```markdown
### Cloze Test

```exam-item
{
  "unitKey": "kaoyan_en1_2026_cloze_1",
  "type": "cloze_choice",
  "displayTitle": "完形填空"
}
```

#### Passage

##### P1
Scientists have found that [1] reading habits can improve memory.

#### Blank 1

```exam-item
{
  "questionKey": "kaoyan_en1_2026_cloze_q1",
  "type": "cloze_choice",
  "answer": "B",
  "points": 0.5
}
```

- A. good
- B. regular
```

Canonical unit 使用 `cloze_choice`，每个 blank 是独立 `cloze_choice` question，带 `blankNumber`。正文 `[N]` 标记必须与 question 一一对应。

## 8. Part B 段落排序 `paragraph_ordering`

```exam-item
{
  "unitKey": "kaoyan_en1_2026_part_b_1",
  "type": "paragraph_ordering",
  "displayTitle": "Part B",
  "slots": [41, 42, 43],
  "fixed": [
    { "position": 0, "candidateKey": "A" },
    { "position": 4, "candidateKey": "E" }
  ],
  "answerSequence": ["A", "B", "C", "D", "E"]
}
```

候选段落使用 `#### Candidate A` 标题；如果来源提供中文译文，可在候选段之后增加：

```markdown
#### Candidate Translations
- A: 候选段 A 的中文译文
- C: 候选段 C 的中文译文
```

该 section 可以只包含部分候选段。待填位置使用 `#### Slot 41` 和 `paragraph_ordering_slot` question。排序判分只使用 stable candidate key，不使用 UI 位置索引。

## 9. Practice Shell

`exam-practice.js` 是共享 Practice Shell，负责 Bottom Sheet、timer、autosave、exit、navigation、bookmark、uncertain、submit 和 attempt lifecycle。题型正文与回答交互由 `src/exam/renderers/` 下的 renderer 提供，禁止按题型复制 Shell。
