export interface FloatingRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

export interface FloatingViewport {
  width: number;
  height: number;
}

export interface FloatingToolbarOptions {
  bottomInset?: number;
  edge?: number;
  gap?: number;
  topInset?: number;
}

export interface FloatingToolbarPosition {
  left: number;
  top: number;
  arrowLeft: number;
  placement: "above" | "below";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/**
 * Place a floating toolbar beside its target while keeping the complete surface
 * inside the visible viewport. The sticky application bar is protected by the
 * top inset, and the toolbar automatically flips below the target when needed.
 */
export function floatingToolbarPosition(
  anchor: FloatingRect,
  toolbar: FloatingSize,
  viewport: FloatingViewport,
  options: FloatingToolbarOptions = {},
): FloatingToolbarPosition {
  const edge = options.edge ?? 10;
  const bottomInset = options.bottomInset ?? edge;
  const gap = options.gap ?? 12;
  const topInset = options.topInset ?? 58;
  const anchorCenter = anchor.left + anchor.width / 2;
  const maximumLeft = viewport.width - edge - toolbar.width;
  const left = clamp(anchorCenter - toolbar.width / 2, edge, maximumLeft);
  const maximumTop = viewport.height - bottomInset - toolbar.height;
  const above = anchor.top - gap - toolbar.height;
  const below = anchor.bottom + gap;

  let placement: FloatingToolbarPosition["placement"] = "above";
  let top = above;

  if (above < topInset) {
    if (below <= maximumTop) {
      placement = "below";
      top = below;
    } else {
      const roomAbove = anchor.top - topInset;
      const roomBelow = viewport.height - bottomInset - anchor.bottom;
      placement = roomAbove >= roomBelow ? "above" : "below";
      top = placement === "above" ? above : below;
    }
  }

  top = clamp(top, Math.min(topInset, maximumTop), maximumTop);

  return {
    left,
    top,
    arrowLeft: clamp(anchorCenter - left, 18, toolbar.width - 18),
    placement,
  };
}
