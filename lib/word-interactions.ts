/**
 * Keep normal browser double/triple-click text selection available beside the
 * word-study action. Recheck selection when the timer fires: the first click
 * often arrives before the browser has completed its selection gesture.
 */
export function createWordActivation(hasSelection: () => boolean, delay = 260) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    cancel,
    click(detail: number, activate: () => void) {
      cancel();
      if (detail > 1 || hasSelection()) return;
      // Assistive-technology click events do not participate in mouse multi-clicks.
      if (detail === 0) { activate(); return; }
      timer = setTimeout(() => {
        timer = null;
        if (!hasSelection()) activate();
      }, delay);
    },
    keyboard(activate: () => void) {
      cancel();
      activate();
    },
  };
}
