"use client";
import { useEffect, useRef, type RefObject } from "react";

/** Trap keyboard focus and restore it without hiding the underlying reader. */
export function useDialog(root: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = root.current;
    if (!element) return;
    const focusable = () => Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter((item) => item.getClientRects().length);
    const first = focusable()[0];
    first?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === items[0] || !element.contains(document.activeElement))) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && (document.activeElement === items.at(-1) || !element.contains(document.activeElement))) { event.preventDefault(); items[0].focus(); }
    };
    element.addEventListener("keydown", keydown);
    return () => { element.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); };
  }, [root]);
}
