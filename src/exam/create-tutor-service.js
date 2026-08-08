import { API } from '../api.js';
import { ChatService } from '../components/chat-service.js';
import { ConversationStore } from '../components/conversation-store.js';
import { ExamTutorMessageBuilder, ExamTutorService } from './exam-tutor-service.mjs';

export function createExamTutorService() {
  const conversationStore = new ConversationStore();
  const chatService = new ChatService({
    api: API,
    agent: {},
    builder: new ExamTutorMessageBuilder()
  });
  return new ExamTutorService({ chatService, conversationStore });
}
