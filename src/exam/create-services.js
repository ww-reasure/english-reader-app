import { DB } from '../db.js';
import { ExamRepository } from './repository.mjs';
import { ExamStateRepository } from './state-repository.mjs';
import { ExamPracticeService } from './practice-service.mjs';

export function createExamServices() {
  const openDb = () => DB.open();
  const contentRepository = new ExamRepository({ openDb });
  const stateRepository = new ExamStateRepository({ openDb });
  const practiceService = new ExamPracticeService({
    contentRepository,
    stateRepository,
    openDb
  });
  return {
    openDb,
    contentRepository,
    stateRepository,
    practiceService
  };
}

