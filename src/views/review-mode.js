import { DB } from '../db.js';
import { ReviewQueue } from '../review-queue.js';

const RECALL_LIMIT = 20;
const CONTEXT_LIMIT = 10;

export const ReviewModeView = {
  container: null,

  async render(container) {
    this.container = container;
    const [dueSummary, allWords] = await Promise.all([
      ReviewQueue.getDueSummary({ recallLimit: RECALL_LIMIT, contextLimit: CONTEXT_LIMIT }),
      DB.getAllLearnWords()
    ]);
    const candidateCount = dueSummary.candidateCount;
    const totalCount = allWords.length;

    container.innerHTML = `
      <main class="app-standard-page review-mode-page" aria-labelledby="reviewModeTitle">
        <section class="review-mode-intro">
          <p class="page-eyebrow">03 / REVIEW LAB</p>
          <h2 id="reviewModeTitle">今天想怎么复习？</h2>
          <p>两种方式共用同一复习队列和排期。一个词在任一方式完成后，未再次到期前不会在另一种方式重复出现。</p>
          <div class="review-mode-count"><strong>${candidateCount}</strong><span>个词可进入复习</span><small>候选 ${candidateCount} · 到期 ${dueSummary.dueCount} · 新词 ${dueSummary.newCount} · 共 ${totalCount} 个</small></div>
        </section>
        <div class="review-mode-grid">
          <a class="review-mode-card review-mode-card--recall ${candidateCount ? '' : 'is-disabled'}" href="${candidateCount ? '#/flashcard/recall' : '#/vocab'}">
            <span class="review-mode-index">01</span>
            <span class="review-mode-icon" aria-hidden="true"><i class="fa-regular fa-eye"></i></span>
            <h3>单词回忆</h3>
            <p>只看英文想释义，直接检验能否独立回忆。证据更强，适合作为主要复习方式。</p>
            <span class="review-mode-enter">${candidateCount ? `开始回忆（最多 ${dueSummary.recallLimit} 个）` : '暂无可复习词'} <i class="fa-solid fa-arrow-right"></i></span>
          </a>
          <a class="review-mode-card review-mode-card--context ${candidateCount ? '' : 'is-disabled'}" href="${candidateCount ? '#/flashcard/context' : '#/vocab'}">
            <span class="review-mode-index">02</span>
            <span class="review-mode-icon" aria-hidden="true"><i class="fa-regular fa-message"></i></span>
            <h3>语境识词</h3>
            <p>在句子中判断目标词，作答后再看本句义和翻译。可以先查询句中的其他词。</p>
            <span class="review-mode-enter">${candidateCount ? `进入语境（最多 ${dueSummary.contextLimit} 个）` : '去添加单词'} <i class="fa-solid fa-arrow-right"></i></span>
          </a>
        </div>
        <p class="review-mode-footnote"><i class="fa-solid fa-link" aria-hidden="true"></i> 共用同一复习队列 · 结果分别统计 · 薄弱词统一进入巩固阅读</p>
      </main>`;
  },

  cleanup() {
    this.container = null;
  }
};
