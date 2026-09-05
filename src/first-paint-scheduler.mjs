/**
 * 首帧后调度：优先双 requestAnimationFrame（前台 ~2 帧即触发），
 * 超时兜底保证后台标签页（rAF 被浏览器冻结，intensive throttling 下
 * 定时器也要等下一次唤醒）最终仍会执行一次，且绝不重复执行。
 */
export function scheduleAfterFirstPaint(callback, {
  requestFrame = globalThis.requestAnimationFrame,
  setTimeoutFn = globalThis.setTimeout,
  fallbackDelay = 1200
} = {}) {
  if (typeof requestFrame === 'function') {
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      callback();
    };
    requestFrame(() => requestFrame(run));
    setTimeoutFn?.(run, fallbackDelay);
    return;
  }
  setTimeoutFn?.(callback, 0);
}
