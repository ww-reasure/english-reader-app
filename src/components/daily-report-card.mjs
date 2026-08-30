const text = value => String(value ?? '').trim();

function escapeHtml(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/=/g, '&#61;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function factsOf(report) {
  return report?.facts && typeof report.facts === 'object'
    ? report.facts
    : report?.data && typeof report.data === 'object'
      ? report.data
      : report || {};
}

function numberOf(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function durationLabel(value) {
  const minutes = Math.max(0, Math.round(numberOf(value) / 60000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}

function accuracyLabel(exam) {
  const accuracy = exam?.objectiveAccuracy;
  if (accuracy === null || accuracy === undefined || accuracy === '') return '暂无数据';
  return `${Math.round(numberOf(accuracy))}%`;
}

function reportIdSuffix(dateKey) {
  return text(dateKey).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'latest';
}

function completenessBadge(facts) {
  const values = Object.values(facts.completeness || {});
  if (values.includes('unavailable')) return '<span class="daily-report-badge is-unavailable">部分数据不可用</span>';
  if (values.includes('partial')) return '<span class="daily-report-badge is-partial">部分数据</span>';
  return '';
}

export function renderDailyReportCard(report = {}) {
  const facts = factsOf(report);
  const vocabulary = facts.vocabulary || {};
  const reading = facts.reading || {};
  const exam = facts.exam || {};
  const analysis = report.aiAnalysis || report.analysis || facts.aiAnalysis || {};
  const dateKey = text(report.dateKey || facts.dateKey) || '今日';
  const summary = text(analysis.summary || analysis.overview) || '今日学习事实已整理完成。';
  const markdown = text(report.markdown || facts.markdown);
  const controlId = `daily-report-content-${reportIdSuffix(dateKey)}`;
  const objectiveAnswered = Math.max(0, Math.trunc(numberOf(exam.objectiveAnswered)));
  const expandedMarkup = markdown
    ? `<div class="daily-report-markdown" data-daily-report-markdown="true"><pre>${escapeHtml(markdown)}</pre></div>`
    : '<p class="daily-report-empty">暂无可展开的完整日报文本。</p>';

  return `<section class="daily-report-card" data-daily-report-card="true" aria-label="${escapeHtml(`${dateKey}英语学习日报`)}">
    <header class="daily-report-card-header">
      <div class="daily-report-card-title">
        <span class="daily-report-kicker">英语学习日报</span>
        <strong>${escapeHtml(dateKey)}</strong>
      </div>
      <div class="daily-report-card-actions">${completenessBadge(facts)}<button class="daily-report-toggle" type="button" aria-expanded="false" aria-controls="${escapeHtml(controlId)}">展开日报</button></div>
    </header>
    <div class="daily-report-summary" data-daily-report-summary="true">
      <div class="daily-report-summary-grid">
        <div class="daily-report-stat"><span>学习总时长</span><strong>${escapeHtml(durationLabel(facts.coreStudyDurationMs))}</strong></div>
        <div class="daily-report-stat"><span>阅读</span><strong>${Math.max(0, Math.trunc(numberOf(reading.completedCount)))} 篇</strong></div>
        <div class="daily-report-stat"><span>客观题</span><strong>${escapeHtml(accuracyLabel(exam))}${objectiveAnswered ? ` · ${objectiveAnswered} 题` : ''}</strong></div>
        <div class="daily-report-stat"><span>新增词</span><strong>${Math.max(0, Math.trunc(numberOf(vocabulary.newUnique)))} 个</strong></div>
        <div class="daily-report-stat"><span>外部复习</span><strong>${Math.max(0, Math.trunc(numberOf(vocabulary.externalReviewed)))} 个</strong></div>
      </div>
      <p class="daily-report-ai-summary">${escapeHtml(summary)}</p>
    </div>
    <div id="${escapeHtml(controlId)}" class="daily-report-expanded" data-daily-report-expanded="true" hidden>
      ${expandedMarkup}
    </div>
  </section>`;
}

export { escapeHtml as escapeDailyReportHtml };
