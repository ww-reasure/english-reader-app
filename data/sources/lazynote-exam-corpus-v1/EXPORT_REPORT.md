# LazyNote Exam Corpus Export Report

**Generated:** 2026-07-29T15:11:37Z
**Dataset Version:** 2026-07-29-v3
**Schema Version:** 1

## Changelog from v2 → v3

- **FIXED:** Word boundary issue in sentenceEn caused by `<mark>` tag concatenation (`get_text(strip=True)` → `get_text(separator=' ', strip=True)`)
- **FIXED:** manifest.source.termsUrl → `https://english-exam.lazynote.cn/terms/`
- **ADDED:** Hard boundary validation: `(?<![A-Za-z])targetForm(?![A-Za-z])` before output
- All examples re-scraped with boundary-safe extraction

## Word Counts by Track

| Track | Frequency Words | Uncovered Words | Total | Examples |
|-------|----------------|-----------------|-------|----------|
| cet4 | 1613 | 1548 | 3161 | 23630 |
| cet6 | 2141 | 1498 | 3639 | 31859 |
| kaoyan-general | 1199 | 1185 | 2384 | 14894 |
| **Total** | **4953** | **4231** | **9184** | **70383** |

## Syllabus Status Distribution

| Status | Count |
|--------|-------|
| in_syllabus | 4134 |
| over_syllabus | 682 |
| uncovered | 4231 |
| unknown | 137 |

## Data Quality

| Check | Value |
|-------|-------|
| Duplicate (track, lemma) | 0 |
| Count inconsistencies | 0 |
| **Invalid target boundary** | **0** |
| **Missing target form** | **0** |
| Total examples exported | 70,383 |
| Examples filtered (boundary fail) | 0 — extraction fix eliminated all boundary issues |
| Filter reason distribution | N/A (zero filtered) |

## Example Distribution

| Source Kind | Count |
|-------------|-------|
| passage | 55650 |
| question | 5266 |
| listening | 0 |
| other | 9467 |

## Kaoyan English I vs II

| Exam Track | Example Count |
|------------|--------------|
| kaoyan1 (英语一) | 9748 |
| kaoyan2 (英语二) | 5146 |

## Boundary Validation Method

```
pattern = re.compile(r'(?<![A-Za-z])' + re.escape(targetForm) + r'(?![A-Za-z])', re.IGNORECASE)
```
All examples pass this check at export time (post-write re-verification).

## File Hashes

| File | SHA-256 |
|------|---------|
| manifest.json | e2cadc28f5822798623d95a5a8075fae5bb82a0fbea27e2280b26152af54e642 |
| words.jsonl.gz | 5b93e9efa016c443dd65cb8adb4682ba6dcfc1fba75a914fd03fb363a7807508 |
| examples.jsonl.gz | d890fcb0a9033cd27bc93eba125c6167560d356a523ebdc659b988ae9f9cf3a6 |

## Files

| File | Records | Compressed | Uncompressed |
|------|---------|------------|--------------|
| words.jsonl.gz | 9,184 | 173,161 B | ~3,157,660 B |
| examples.jsonl.gz | 70,383 | 11,726,947 B | ~41,365,808 B |
