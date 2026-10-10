import type { Chapter } from "./getbible.ts";
import type { Marking } from "./markings.ts";
import { coordinateReference, queryScripture } from "./scripture-api.ts";

export interface BookmarkPreviewTarget {
  key: string;
  translation: string;
  reference: string;
}

export interface BookmarkPreview {
  text?: string;
  reference?: string;
  direction?: "ltr" | "rtl";
  error?: boolean;
}

type ScriptureQuery = (translation: string, reference: string, signal?: AbortSignal) => Promise<Chapter[]>;

const isSelection = (marking: Marking): boolean => marking.start !== null || marking.end !== null;

/** Whole verses follow the reader; word offsets always belong to their saved translation. */
export function bookmarkPreviewTarget(marking: Marking, currentTranslation: string): BookmarkPreviewTarget {
  const translation = (isSelection(marking) ? marking.passage.translation : currentTranslation).toLowerCase();
  return {
    key: `${translation}/${marking.passage.book}/${marking.passage.chapter}/${marking.verse}`,
    translation,
    reference: coordinateReference(marking.passage.book, marking.passage.chapter, marking.verse),
  };
}

/** Preserve the exact saved selection even when upstream text or its offsets have changed. */
export function bookmarkPreviewText(marking: Marking, verseText?: string, currentTranslation = marking.passage.translation): string {
  if (!isSelection(marking)) {
    return verseText ?? (marking.passage.translation.toLowerCase() === currentTranslation.toLowerCase() ? marking.quote : "");
  }
  if (marking.quote.trim()) return marking.quote;
  const { start, end } = marking;
  if (verseText === undefined || start === null || end === null || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end <= start || end > verseText.length) return "";
  return verseText.slice(start, end);
}

/** Load each distinct verse once, streaming rows as they arrive without flooding the query API. */
export async function loadBookmarkPreviews(
  markings: readonly Marking[],
  currentTranslation: string,
  onPreview: (key: string, preview: BookmarkPreview) => void,
  signal?: AbortSignal,
  query: ScriptureQuery = queryScripture,
): Promise<void> {
  if (signal?.aborted) return;
  const pending = new Map<string, { target: BookmarkPreviewTarget; marking: Marking }>();
  for (const marking of markings) {
    const target = bookmarkPreviewTarget(marking, currentTranslation);
    if (!pending.has(target.key)) pending.set(target.key, { target, marking });
  }
  const requests = [...pending.values()];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (!signal?.aborted && cursor < requests.length) {
      const { target, marking } = requests[cursor++];
      let preview: BookmarkPreview;
      try {
        const chapters = await query(target.translation, target.reference, signal);
        if (signal?.aborted) return;
        const chapter = chapters.find(item => item.abbreviation?.toLowerCase() === target.translation
          && item.book_nr === marking.passage.book && item.chapter === marking.passage.chapter);
        const verse = chapter?.verses.find(item => item.verse === marking.verse);
        if (!chapter || !verse || typeof verse.text !== "string" || !verse.text.trim()) throw new Error("Bookmark verse was not returned");
        preview = {
          text: verse.text,
          reference: verse.name?.trim() || `${chapter.book_name} ${chapter.chapter}:${verse.verse}`,
          direction: chapter.direction?.toLowerCase() === "rtl" ? "rtl" : "ltr",
        };
      } catch {
        if (signal?.aborted) return;
        preview = { error: true };
      }
      if (!signal?.aborted) onPreview(target.key, preview);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, requests.length) }, () => worker()));
}
