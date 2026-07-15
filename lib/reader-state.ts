export function boundaryTurn(
  deltaY: number,
  scrollY: number,
  viewportHeight: number,
  documentHeight: number,
): -1 | 0 | 1 {
  if (deltaY > 0 && viewportHeight + scrollY >= documentHeight - 2) return 1;
  if (deltaY < 0 && scrollY <= 1) return -1;
  return 0;
}

export interface BoundaryIntent { direction: -1 | 1; at: number }

export function boundaryIntent(
  current: BoundaryIntent | null,
  direction: -1 | 1,
  now: number,
  minimumGap = 320,
  maximumGap = 1800,
): { intent: BoundaryIntent; turn: -1 | 0 | 1 } {
  const elapsed = current?.direction === direction ? now - current.at : Number.POSITIVE_INFINITY;
  if (current && current.direction === direction && elapsed >= minimumGap && elapsed <= maximumGap) {
    return { intent: { direction, at: now }, turn: direction };
  }
  if (current && current.direction === direction && elapsed < minimumGap) return { intent: current, turn: 0 };
  return { intent: { direction, at: now }, turn: 0 };
}

export function readerStorageKeys(keys: string[]): string[] {
  return keys.filter((key) => key.startsWith("getbible-reader:"));
}
