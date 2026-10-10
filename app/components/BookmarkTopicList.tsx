"use client";

import { useEffect, useState } from "react";
import type { Marking, MarkingColor } from "../../lib/markings";
import type { BookmarkDisplayRow } from "../../lib/shared-bookmarks";
import type { createUiTranslator } from "../../lib/i18n";
import { bookmarkPreviewTarget, bookmarkPreviewText, loadBookmarkPreviews, type BookmarkPreview } from "../../lib/bookmark-previews";
import "./bookmark-topic-list.css";

interface BookmarkTopicRowProps {
  row: BookmarkDisplayRow;
  color?: MarkingColor;
  translation: string;
  preview?: BookmarkPreview;
  t: ReturnType<typeof createUiTranslator>;
  onOpen: (marking: Marking) => void;
  onDelete: (row: BookmarkDisplayRow) => void;
}

export function BookmarkTopicRow({ row, color, translation, preview, t, onOpen, onDelete }: BookmarkTopicRowProps) {
  const { marking } = row;
  const target = bookmarkPreviewTarget(marking, translation);
  const selected = marking.start !== null || marking.end !== null;
  const text = bookmarkPreviewText(marking, preview?.text, translation);
  const reference = preview?.reference ?? marking.reference ?? t("verseNumber", { verse: marking.verse });
  return <li>
    <button className="marking-link bookmark-preview-link" type="button" onClick={() => onOpen(marking)}>
      <span className="marking-dot" style={{ backgroundColor: color?.value }} />
      <span>
        <strong className="bookmark-preview-reference"><bdi>{reference}</bdi>{row.global ? <span className="global-bookmark-badge" title={t("globalBookmark")} aria-label={t("globalBookmark")}>G</span> : null}</strong>
        {text ? <span className="bookmark-preview-text" dir={preview?.direction ?? "auto"}>{text}</span>
          : <span className="bookmark-preview-status">{t(preview ? "passageLoadError" : "loadingPassage")}</span>}
        <em>{color?.name ?? t("marking")}{row.personal && row.global ? " · personal bookmark also saved" : ""}</em>
        {selected ? <span className="bookmark-preview-caption">{t("selectedText")} · {target.translation.toUpperCase()}</span> : null}
      </span>
    </button>
    <button className="delete-marking" type="button" aria-label={t("deleteMarkingFor", { reference })} onClick={() => onDelete(row)}>×</button>
  </li>;
}

export interface BookmarkTopicListProps {
  rows: BookmarkDisplayRow[];
  colors: Map<string, MarkingColor>;
  translation: string;
  t: ReturnType<typeof createUiTranslator>;
  onOpen: (marking: Marking) => void;
  onDelete: (row: BookmarkDisplayRow) => void;
}

/** Keep transient API previews separate from the user's saved bookmarks. */
export function BookmarkTopicList({ rows, colors, translation, t, onOpen, onDelete }: BookmarkTopicListProps) {
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify([translation, retry, rows.map(({ marking }) => [marking.id, bookmarkPreviewTarget(marking, translation).key])]);
  const [result, setResult] = useState<{ key: string; previews: Record<string, BookmarkPreview> }>({ key: "", previews: {} });
  const previews = result.key === requestKey ? result.previews : {};

  useEffect(() => {
    const controller = new AbortController();
    void loadBookmarkPreviews(rows.map((row) => row.marking), translation, (key, preview) => {
      if (controller.signal.aborted) return;
      setResult((current) => ({ key: requestKey, previews: { ...(current.key === requestKey ? current.previews : {}), [key]: preview } }));
    }, controller.signal);
    return () => controller.abort();
  }, [rows, translation, requestKey]);

  const failed = Object.values(previews).some((preview) => preview.error);
  const pending = rows.some(({ marking }) => !previews[bookmarkPreviewTarget(marking, translation).key]);
  return <>
    {pending ? <p className="bookmark-preview-notice" role="status">{t("loadingPassage")}…</p> : null}
    {failed ? <div className="bookmark-preview-notice"><span role="status">{t("passageLoadError")}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>{t("tryAgain")}</button></div> : null}
    <ul className="marking-list bookmark-preview-list">
      {rows.map((row) => <BookmarkTopicRow key={row.marking.id} row={row} color={colors.get(row.marking.colorId)} translation={translation}
        preview={previews[bookmarkPreviewTarget(row.marking, translation).key]} t={t} onOpen={onOpen} onDelete={onDelete} />)}
    </ul>
  </>;
}
