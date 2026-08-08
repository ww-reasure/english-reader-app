# Synthetic 2026 Reading A

```exam-meta
{
  "schema": "exam-md-v1",
  "examId": "kaoyan_en1",
  "bankId": "synthetic_kaoyan_bank",
  "packageId": "synthetic.kaoyan.en1",
  "packageVersion": "1.0.0",
  "paperKey": "synthetic_kaoyan_2026",
  "year": 2026,
  "sourceType": "synthetic"
}
```

## Section II Part A

### Text 1

```exam-item
{
  "unitKey": "synthetic_kaoyan_2026_text_1",
  "type": "reading_mcq",
  "displayTitle": "Text 1"
}
```

#### Passage

##### P1
A small team of engineers built a synthetic reading passage for automated testing.
The passage must not depend on any private exam source.

##### P2
Stable identifiers keep user progress attached to the same questions after content updates.
Tests use only this fixture and never real exam text.

#### Passage Translation

##### P1
一个小型工程师团队构建了用于自动化测试的合成阅读文章。
该文章不得依赖任何私有真题来源。

##### P2
稳定标识确保题库内容更新后，用户进度仍关联到同一道题。
测试只使用该 fixture，绝不使用真实真题文本。

#### Q21

```exam-item
{
  "questionKey": "synthetic_kaoyan_2026_q21",
  "type": "single_choice",
  "answer": "B",
  "points": 2
}
```

What is the purpose of the synthetic passage?

- A. To replace real exam papers in production.
- B. To support automated testing without private sources.
- C. To generate article difficulty statistics.
- D. To store user answers in the articles store.

##### Question Translation
合成文章的目的是什么？

##### Question Type
细节题

##### Location
P1

##### Evidence
The passage must not depend on any private exam source.

##### Explanation
The fixture is designed for automated tests and explicitly avoids private exam content.

##### Option Analysis
- A: Incorrect, synthetic content never replaces real production papers.
- B: Correct, the fixture enables testing without private sources.
- C: Incorrect, the fixture is not a corpus builder.
- D: Incorrect, user answers do not belong in the articles store.

#### Q22

```exam-item
{
  "questionKey": "synthetic_kaoyan_2026_q22",
  "type": "single_choice",
  "answer": "A",
  "points": 2
}
```

What do stable identifiers help preserve after a pack upgrade?

- A. User progress attached to the same question keys.
- B. The original PDF file inside IndexedDB.
- C. The exact wording of the old passage forever.
- D. The current UI preference for the exam home.

##### Question Translation
稳定标识在题库升级后有助于保留什么？

##### Question Type
细节题

##### Location
P2

##### Evidence
Stable identifiers keep user progress attached to the same questions after content updates.

##### Explanation
Progress is linked through stable question keys; content itself may change.

##### Option Analysis
- A: Correct, stable keys preserve progress associations.
- B: Incorrect, PDFs are not stored in IndexedDB.
- C: Incorrect, wording may be corrected during upgrades.
- D: Incorrect, UI preference is unrelated to data association.
