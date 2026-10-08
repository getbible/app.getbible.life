import { parseMarkingsBackup, type Marking, type MarkingColor } from "./markings.ts";

export const BOOKMARK_STORAGE_KEY = "getbible-reader:bookmark-topics:v2";

export interface BookmarkStateSnapshot {
  version: 2;
  colors: MarkingColor[];
  markings: Marking[];
  activeColorId: string;
  setup: "fresh" | "legacy" | "current";
}

/** Keep storage injectable so private-mode and quota failures can be handled by callers. */
export interface BookmarkStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function parseBookmarkState(value: unknown): BookmarkStateSnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid bookmark state.");
  const snapshot = value as Partial<BookmarkStateSnapshot>;
  if (snapshot.version !== 2 || typeof snapshot.activeColorId !== "string" ||
    (snapshot.setup !== "fresh" && snapshot.setup !== "legacy" && snapshot.setup !== "current")) {
    throw new Error("Invalid bookmark state.");
  }
  const backup = parseMarkingsBackup({
    version: 2,
    exportedAt: "",
    colors: snapshot.colors,
    markings: snapshot.markings,
  });
  return {
    version: 2,
    colors: backup.colors,
    markings: backup.markings,
    activeColorId: snapshot.activeColorId,
    setup: snapshot.setup,
  };
}

/** Corrupt, missing, or inaccessible storage leaves legacy fallback available. */
export function readBookmarkState(storage: Pick<BookmarkStorage, "getItem">): BookmarkStateSnapshot | null {
  try {
    const stored = storage.getItem(BOOKMARK_STORAGE_KEY);
    return stored === null ? null : parseBookmarkState(JSON.parse(stored));
  } catch {
    return null;
  }
}

/** One atomic browser-storage replacement keeps topic IDs and their bookmarks together. */
export function writeBookmarkState(storage: Pick<BookmarkStorage, "setItem">, snapshot: BookmarkStateSnapshot): void {
  const validated = parseBookmarkState(snapshot);
  storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(validated));
}
