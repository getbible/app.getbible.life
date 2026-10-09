"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { floatingToolbarPosition, type FloatingRect } from "../../lib/floating-toolbar";
import type { createUiTranslator } from "../../lib/i18n";
import type { MarkingColor } from "../../lib/markings";
import "./bookmark-menu.css";

export interface BookmarkMenuAssignment {
  id: string;
  colorId: string;
  quote?: string;
  hasGlobal: boolean;
  hasPersonal: boolean;
}

export interface BookmarkMenuProps {
  reference: string;
  quote?: string;
  anchor: { getBoundingClientRect(): FloatingRect };
  colors: MarkingColor[];
  assignments: BookmarkMenuAssignment[];
  /** Only topics already assigned to the exact verse or selected text target. */
  assignedTopicIds: string[];
  recentColorIds?: string[];
  t: ReturnType<typeof createUiTranslator>;
  onAdd: (colorId: string) => void;
  onRemove: (id: string, origin: "personal" | "global") => void;
  onOpenTopic: (colorId: string) => void;
  onManageTopics: () => void;
  onClose: () => void;
}

const searchKey = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();

export function BookmarkMenu({ reference, quote, anchor, colors, assignments, assignedTopicIds, recentColorIds = [], t, onAdd, onRemove, onOpenTopic, onManageTopics, onClose }: BookmarkMenuProps) {
  const root = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  const headingId = useId();
  const pickerId = useId();
  const [pickerOpen, setPickerOpen] = useState(assignments.length === 0);
  const [query, setQuery] = useState("");
  const assignedIds = new Set(assignedTopicIds);
  const available = colors.filter((color) => !assignedIds.has(color.id));
  const matching = available.filter((color) => searchKey(color.name).includes(searchKey(query.trim())));
  const recent = Array.from(new Set(recentColorIds)).flatMap((id) => matching.find((color) => color.id === id) ?? []).slice(0, 6);
  const recentIds = new Set(recent.map((color) => color.id));
  const other = matching.filter((color) => !recentIds.has(color.id)).sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => { close.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      if (rect.bottom < 48 || rect.top > window.innerHeight) { close.current(); return; }
      const next = floatingToolbarPosition(rect, { width: element.offsetWidth, height: element.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, { bottomInset: window.innerWidth <= 720 ? 58 : 10 });
      element.style.left = `${next.left}px`;
      element.style.top = `${next.top}px`;
      element.dataset.positioned = "true";
    };
    position();
    const resize = new ResizeObserver(position);
    resize.observe(element);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [anchor]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.focus({ preventScroll: true });
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target)) close.current();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
    };
    // This dialog is non-modal: tabbing back into the reader dismisses it.
    const focusOutside = (event: FocusEvent) => {
      if (event.target instanceof Node && !element.contains(event.target)) close.current();
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusOutside);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusOutside);
      if (previous?.isConnected && (element.contains(document.activeElement) || document.activeElement === document.body)) previous.focus({ preventScroll: true });
    };
  }, []);

  const topicButton = (color: MarkingColor) => <button type="button" className="bookmark-menu-topic" key={color.id} onClick={() => { onAdd(color.id); setQuery(""); search.current?.focus({ preventScroll: true }); }}>
    <span className="bookmark-menu-dot" style={{ backgroundColor: color.value }} aria-hidden="true" />
    <span>{color.name}</span><span className="bookmark-menu-plus" aria-hidden="true">+</span>
  </button>;

  return <section className="bookmark-menu" ref={root} role="dialog" aria-labelledby={headingId} tabIndex={-1}>
    <header className="bookmark-menu-header">
      <h2 id={headingId}>{t("verseBookmarks", { reference })}</h2>
      <button type="button" className="bookmark-menu-icon" onClick={onClose} aria-label={t("closeMenu")}>×</button>
    </header>
    <div className="bookmark-menu-body">
      {quote && <div className="bookmark-menu-selection"><small>{t("selectedText")}</small><p dir="auto">“{quote}”</p></div>}
      {assignments.length ? <ul className="bookmark-menu-assignments">
        {assignments.map((assignment) => {
          const color = colors.find((item) => item.id === assignment.colorId);
          if (!color) return null;
          const remove = (origin: "personal" | "global") => { root.current?.focus({ preventScroll: true }); onRemove(assignment.id, origin); };
          return <li key={assignment.id}>
            <button type="button" className="bookmark-menu-assignment" onClick={() => onOpenTopic(color.id)} title={t("openBookmarkTopic", { topic: color.name })}>
              <span className="bookmark-menu-dot" style={{ backgroundColor: color.value }} aria-hidden="true" />
              <span className="bookmark-menu-name"><strong>{color.name}</strong>{assignment.quote && <small dir="auto">“{assignment.quote}”</small>}</span>
            </button>
            {assignment.hasGlobal && <button type="button" className="bookmark-menu-remove" onClick={() => remove("global")} aria-label={t("removeGlobalBookmark", { topic: color.name })} title={t("removeGlobalBookmark", { topic: color.name })}><span className="bookmark-menu-global" aria-label={t("globalBookmark")}>G</span><span aria-hidden="true">×</span></button>}
            {assignment.hasPersonal && <button type="button" className="bookmark-menu-remove" onClick={() => remove("personal")} aria-label={t("removePersonalBookmark", { topic: color.name })} title={t("removePersonalBookmark", { topic: color.name })}><span aria-hidden="true">×</span></button>}
          </li>;
        })}
      </ul> : <p className="bookmark-menu-empty">{t("noVerseBookmarks")}</p>}
      <button type="button" className="bookmark-menu-add" aria-expanded={pickerOpen} aria-controls={pickerId} onClick={() => setPickerOpen(!pickerOpen)}><span aria-hidden="true">+</span> {t("addAnotherTopic")}</button>
      {pickerOpen && <div className="bookmark-menu-picker" id={pickerId}>
        <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} type="search" aria-label={t("findTopic")} placeholder={t("findTopic")} />
        <div className="bookmark-menu-options">
          {!!recent.length && <section aria-label={t("recentTopics")}><h3>{t("recentTopics")}</h3>{recent.map(topicButton)}</section>}
          {!!other.length && <section aria-label={t("allTopics")}><h3>{t("allTopics")}</h3>{other.map(topicButton)}</section>}
          {!matching.length && <p className="bookmark-menu-empty">{t(available.length ? "noMatchingTopics" : "allTopicsAssigned")}</p>}
        </div>
      </div>}
    </div>
    <footer><button type="button" onClick={onManageTopics}>{t("manageTopics")}</button></footer>
  </section>;
}
