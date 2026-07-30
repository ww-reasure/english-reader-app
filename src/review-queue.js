import { DB } from './db.js';
import { SpacedRepetition } from './spaced-repetition.js';
import { ReviewQueueCoordinator } from './review-queue-coordinator.mjs';
import { Config } from './config.js';
import { ExamCorpus } from './exam-corpus-runtime.mjs';

// The two review experiences intentionally share this one queue facade. The
// persisted reviewRevision remains the authority across tabs and restored views.
export const ReviewQueue = new ReviewQueueCoordinator({
  db: DB,
  srs: SpacedRepetition,
  examPriority: async (word, targetTrack) => {
    const record = await ExamCorpus.lookup(word?.word, targetTrack || Config.get('exam_level') || '');
    return Number(record?.priorityScore) || 0;
  }
});
