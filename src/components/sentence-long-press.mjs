const DEFAULT_DURATION = 500;
const DEFAULT_MOVEMENT_THRESHOLD = 12;

export function bindSentenceLongPress({
  root,
  onLongPress,
  onLongPressEnd = () => {},
  shouldIgnore = () => false,
  duration = DEFAULT_DURATION,
  movementThreshold = DEFAULT_MOVEMENT_THRESHOLD,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout
} = {}) {
  if (!root?.addEventListener || typeof onLongPress !== 'function') return () => {};

  let active = null;
  let timer = null;
  let completedPointerId = null;

  const cancel = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
    active = null;
    completedPointerId = null;
  };

  const onPointerDown = event => {
    cancel();
    if (!event?.isPrimary || !['touch', 'pen'].includes(event.pointerType) || shouldIgnore(event)) return;
    active = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, event };
    timer = setTimer(() => {
      const snapshot = active;
      timer = null;
      active = null;
      if (snapshot) {
        completedPointerId = snapshot.pointerId;
        onLongPress(snapshot.event);
      }
    }, duration);
  };

  const onPointerMove = event => {
    if (!active || event.pointerId !== active.pointerId) return;
    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > movementThreshold) cancel();
  };
  const onPointerEnd = event => {
    if (completedPointerId != null && event?.pointerId === completedPointerId) onLongPressEnd(event);
    if (!active || event?.pointerId === active.pointerId) cancel();
  };
  const onScroll = () => {
    if (completedPointerId != null) onLongPressEnd();
    cancel();
  };

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerEnd);
  root.addEventListener('pointercancel', onPointerEnd);
  root.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    cancel();
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerEnd);
    root.removeEventListener('pointercancel', onPointerEnd);
    root.removeEventListener('scroll', onScroll);
  };
}
