const revisionOf = word => Math.max(0, Math.trunc(Number(word?.reviewRevision) || 0));

export class ReviewQueueCoordinator {
  constructor({ db, srs, examPriority = async () => 0, now = () => Date.now() } = {}) {
    if (!db || !srs) throw new TypeError('共享复习队列需要 DB 与 SRS');
    this.db = db;
    this.srs = srs;
    this.examPriority = examPriority;
    this.now = now;
  }

  async getDueWords({ limit = 20, targetTrack = '', words: wordSnapshot = null } = {}) {
    const sourceWords = Array.isArray(wordSnapshot) ? wordSnapshot : await this.db.getAllLearnWords();
    const words = sourceWords.filter(word => word?.archivedAt == null);
    const scored = await Promise.all(words.map(async (word, index) => ({
      word,
      index,
      score: Math.max(0, Number(await Promise.resolve(this.examPriority(word, targetTrack)).catch(() => 0)) || 0)
    })));
    const recoveryFirst = word => Math.max(0, Math.trunc(Number(word?.recoveryStage) || 0)) > 0;
    const scheduleKey = word => [
      word?.nextReview || 0,
      word?.state || 'new',
      Number(word?.interval) || 0,
      Number(word?.learningStep) || 0
    ].join(':');
    scored.sort((left, right) => {
      const leftRecovery = recoveryFirst(left.word) ? 0 : 1;
      const rightRecovery = recoveryFirst(right.word) ? 0 : 1;
      if (leftRecovery !== rightRecovery) return leftRecovery - rightRecovery;
      return scheduleKey(left.word) === scheduleKey(right.word)
      ? right.score - left.score || left.index - right.index
      : left.index - right.index;
    });
    return this.srs.getDueWords(scored.map(item => item.word), limit, { recoveryFirst: true })
      .filter(word => word?.archivedAt == null)
      .map(word => ({
        ...word,
        expectedRevision: revisionOf(word)
      }));
  }

  async getDueSummary({ targetTrack = '', recallLimit = 20, contextLimit = 10, words: wordSnapshot = null } = {}) {
    const sourceWords = Array.isArray(wordSnapshot) ? wordSnapshot : await this.db.getAllLearnWords();
    const words = sourceWords.filter(word => word?.archivedAt == null);
    const now = this.now();
    const isRecovery = word => Math.max(0, Math.trunc(Number(word?.recoveryStage) || 0)) > 0;
    const isDue = word => isRecovery(word) || (!word?.nextReview || Number(word.nextReview) <= now);
    const dueCount = words.filter(word => isRecovery(word) || (word?.nextReview && Number(word.nextReview) <= now)).length;
    const newCount = words.filter(word => !word?.nextReview).length;
    const candidateWords = words.length
      ? this.srs.getDueWords(words, words.length, {
        recoveryFirst: true,
        newLimit: words.length,
        targetTrack
      })
      : [];
    return {
      candidateCount: candidateWords.length,
      recoveryCount: candidateWords.filter(isRecovery).length,
      dueCount,
      newCount,
      recallLimit: Math.max(0, Number(recallLimit) || 20),
      contextLimit: Math.max(0, Number(contextLimit) || 10)
    };
  }

  async revalidate(candidate) {
    const currentWord = await this.db.findLearnWordById(candidate?.id);
    if (!currentWord) return { current: false, reason: 'missing-word', word: null };
    if (currentWord.archivedAt != null) return { current: false, reason: 'archived-word', word: null };
    if (revisionOf(currentWord) !== revisionOf({ reviewRevision: candidate?.expectedRevision })) {
      return { current: false, reason: 'reviewed-elsewhere', word: null };
    }
    // V2：recovery 词与已进入会话的词不再因“未到期”被踢出；revision 一致即可复习。
    return {
      current: true,
      reason: '',
      word: { ...currentWord, expectedRevision: revisionOf(currentWord) }
    };
  }
}

export const getReviewRevision = revisionOf;
