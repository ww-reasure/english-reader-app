const DEFAULT_DURATION = 500;
const DEFAULT_MOVEMENT_THRESHOLD = 12;
const DEFAULT_NATIVE_SELECTION_CLASS = 'sentence-long-press-pending';

/**
 * Keeps a programmatic sentence selection ahead of the native click and any
 * generic selection menu that normally follow a successful touch long press.
 */
export function createLongPressSelectionGuard() {
  let automaticSelection = false;
  let pendingClick = false;

  return {
    markAutomaticSelection() {
      automaticSelection = true;
      pendingClick = true;
    },
    consumeClick() {
      if (!pendingClick) return false;
      pendingClick = false;
      return true;
    },
    shouldIgnoreSelection() {
      return automaticSelection;
    },
    clear() {
      automaticSelection = false;
      pendingClick = false;
    }
  };
}

export function bindSentenceLongPress({
  root,
  onLongPress,
  onLongPressEnd = () => {},
  shouldIgnore = () => false,
  duration = DEFAULT_DURATION,
  movementThreshold = DEFAULT_MOVEMENT_THRESHOLD,
  preventNativeTextSelection = false,
  nativeSelectionClass = DEFAULT_NATIVE_SELECTION_CLASS,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout
} = {}) {
  if (!root?.addEventListener || typeof onLongPress !== 'function') return () => {};

  let active = null;
  let timer = null;
  let completedPointerId = null;
  let nativeSelectionInterceptionActive = false;
  let nativeSelectionClassApplied = false;

  const removeNativeSelectionClass = () => {
    if (!nativeSelectionClassApplied) return;
    root.classList?.remove?.(nativeSelectionClass);
    nativeSelectionClassApplied = false;
  };
  const clearNativeSelectionSuppression = () => {
    removeNativeSelectionClass();
    nativeSelectionInterceptionActive = false;
  };
  const startNativeSelectionSuppression = () => {
    if (!preventNativeTextSelection) return;
    nativeSelectionInterceptionActive = true;
    root.classList?.add?.(nativeSelectionClass);
    nativeSelectionClassApplied = true;
  };

  const cancel = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
    active = null;
    completedPointerId = null;
    clearNativeSelectionSuppression();
  };

  const onPointerDown = event => {
    cancel();
    if (!event?.isPrimary || !['touch', 'pen'].includes(event.pointerType) || shouldIgnore(event)) return;
    active = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, event };
    startNativeSelectionSuppression();
    timer = setTimer(() => {
      const snapshot = active;
      timer = null;
      active = null;
      if (snapshot) {
        removeNativeSelectionClass();
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
  const preventNativeSelection = event => {
    if (!nativeSelectionInterceptionActive) return;
    event?.preventDefault?.();
  };

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerEnd);
  root.addEventListener('pointercancel', onPointerEnd);
  root.addEventListener('scroll', onScroll, { passive: true });
  root.addEventListener('selectstart', preventNativeSelection, true);
  root.addEventListener('contextmenu', preventNativeSelection, true);

  return () => {
    cancel();
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerEnd);
    root.removeEventListener('pointercancel', onPointerEnd);
    root.removeEventListener('scroll', onScroll);
    root.removeEventListener('selectstart', preventNativeSelection, true);
    root.removeEventListener('contextmenu', preventNativeSelection, true);
  };
}
