export type ScrollDirection = -1 | 0 | 1;

export interface BoundaryScrollState {
  direction: ScrollDirection;
  gestures: number;
  lastEventAt: number;
}

export const EMPTY_BOUNDARY_SCROLL: BoundaryScrollState = {
  direction: 0,
  gestures: 0,
  lastEventAt: 0,
};

export function registerBoundaryScroll(
  current: BoundaryScrollState,
  direction: -1 | 1,
  atBoundary: boolean,
  now: number,
): { state: BoundaryScrollState; navigate: boolean } {
  if (!atBoundary) return { state: EMPTY_BOUNDARY_SCROLL, navigate: false };

  const gap = now - current.lastEventAt;
  const sameGesture = current.direction === direction && gap >= 0 && gap < 180;
  const expired = gap > 1400;
  const gestures = sameGesture
    ? current.gestures
    : expired || current.direction !== direction
      ? 1
      : current.gestures + 1;

  if (gestures >= 2) return { state: EMPTY_BOUNDARY_SCROLL, navigate: true };
  return { state: { direction, gestures, lastEventAt: now }, navigate: false };
}
