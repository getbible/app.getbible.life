/** Defer a loading indicator without letting a fast cached read start it after completion. */
export function deferLoading(onStart: () => void, onFinish: () => void): { finish: () => void; cancel: () => void } {
  let closed = false;
  const timer = setTimeout(() => { if (!closed) onStart(); }, 0);
  return {
    finish() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      onFinish();
    },
    cancel() {
      closed = true;
      clearTimeout(timer);
    },
  };
}
