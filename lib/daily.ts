import { bookMatchesSlug } from "./getbible.ts";
import type { Book, Chapter, Passage } from "./getbible.ts";

export const DAILY_SCRIPTURE_URL = "https://raw.githubusercontent.com/trueChristian/daily-scripture/refs/heads/master/README.json";
export const DAILY_SCRIPTURE_CACHE = "getbible-reader:daily:v1";
export const DEFAULT_TRANSLATION = "kjv";

export interface DailyReference {
  date: string;
  translation: string;
  bookName: string;
  chapter: number;
  verse: number;
  /** All selected verse numbers in this chapter, including ranges in the feed. */
  verses: number[];
}

export type DailyPassage = Passage & { bookName: string; verse: number; verses: number[] };

function positiveNumber(value: unknown): number | null {
  const number = Number(String(value ?? "").match(/\d+/)?.[0]);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** The daily reader opens one chapter; ignore explicitly different chapter coordinates. */
function verseNumbers(value: unknown, chapter: number): number[] {
  if (Array.isArray(value)) return value.flatMap((item) => verseNumbers(item, chapter));
  if (typeof value !== "string" && typeof value !== "number") return [];
  const parts = String(value).trim().replace(/\s*([-\u2013\u2014:])\s*/g, "$1").split(/[,;\s]+/);
  let selectedChapter = chapter;
  return parts.flatMap((part) => {
    const match = part.match(/^(?:(\d+):)?(\d+)(?:[-\u2013\u2014](\d+))?$/);
    if (!match) return [];
    if (match[1]) selectedChapter = Number(match[1]);
    if (selectedChapter !== chapter) return [];
    const first = Number(match[2]);
    const last = Number(match[3] ?? match[2]);
    // Bound range expansion to avoid malformed external data blocking the reader.
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last - first > 1_000) return [];
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  });
}

/** Keep long daily readings inside the Query API's reference-length budget. */
function verseSelection(verses: number[]): string {
  const selections: string[] = [];
  for (let index = 0; index < verses.length; index++) {
    const first = verses[index];
    while (index + 1 < verses.length && verses[index + 1] === verses[index] + 1) index++;
    const last = verses[index];
    selections.push(first === last ? String(first) : `${first}-${last}`);
  }
  return selections.join(",");
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dailyDateKey(value: string): string | null {
  const normalized = value.replace(/(\d{1,2})-([A-Za-z]+)/, "$1 $2");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : localDateKey(parsed);
}

export function dailyIsCurrent(date: string, now = new Date()): boolean {
  return dailyDateKey(date) === localDateKey(now);
}

export function parseDailyReference(value: unknown): DailyReference {
  if (!value || typeof value !== "object") throw new Error("The daily Scripture response is invalid.");
  const data = value as Record<string, unknown>;
  const date = String(data.date ?? "");
  const link = String(data.getbible ?? data.url ?? data.link ?? "");
  const name = String(data.name ?? data.reference ?? "");
  const urlParts = link.split("/").filter(Boolean);
  const getBibleIndex = urlParts.findIndex((part) => part.toLowerCase().includes("getbible.life"));
  const path = getBibleIndex >= 0 ? urlParts.slice(getBibleIndex + 1) : [];
  const referenceMatch = name.match(/^(.+?)\s+(\d+)\s*:\s*(.+)/);
  const scripture = Array.isArray(data.scripture) ? data.scripture.filter((item): item is Record<string, unknown> =>
    item !== null && typeof item === "object" && !Array.isArray(item)) : [];

  const translation = String(data.translation ?? data.version ?? path[0] ?? "kjv").toLowerCase();
  const bookName = String(data.book ?? path[1] ?? referenceMatch?.[1] ?? "").replaceAll("%20", " ");
  const chapter = positiveNumber(data.chapter ?? path[2] ?? referenceMatch?.[2]);
  if (!date || !bookName || !chapter) throw new Error("The daily Scripture response does not contain a complete reference.");
  const selected = [data.verse, data.verses, path[3], referenceMatch?.[3]].flatMap((value) => verseNumbers(value, chapter));
  selected.push(...scripture.flatMap((item) => positiveNumber(item.chapter ?? item.chapter_nr ?? chapter) === chapter ? verseNumbers(item.nr, chapter) : []));
  const verse = selected[0];
  if (!verse) throw new Error("The daily Scripture response does not contain a complete reference.");
  const verses = [...new Set(selected)].sort((first, second) => first - second);
  return { date, translation, bookName, chapter, verse, verses };
}

type DailyStorage = Pick<Storage, "getItem" | "setItem">;
function browserStorage(): DailyStorage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/** Invalid or unavailable persistence must never prevent opening today's verse. */
export async function loadDailyReference(
  now = new Date(),
  storage: DailyStorage | undefined = browserStorage(),
  fetcher: typeof fetch = globalThis.fetch,
): Promise<DailyReference> {
  try {
    const saved = storage?.getItem(DAILY_SCRIPTURE_CACHE);
    if (saved) {
      const reference = parseDailyReference(JSON.parse(saved));
      if (dailyIsCurrent(reference.date, now)) return reference;
    }
  } catch { /* A corrupt cache or denied storage is a cache miss. */ }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetcher(DAILY_SCRIPTURE_URL, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Daily Scripture returned HTTP ${response.status}.`);
    const data: unknown = await response.json();
    const reference = parseDailyReference(data);
    try { storage?.setItem(DAILY_SCRIPTURE_CACHE, JSON.stringify(data)); } catch { /* Reading works without persistence. */ }
    return reference;
  } finally { clearTimeout(timer); }
}

/** The Query API resolves source book aliases to v3's canonical book identity. */
export async function resolveDailyPassage(
  reference: DailyReference,
  books: Book[],
  query: (reference: string) => Promise<Chapter[]>,
): Promise<DailyPassage> {
  const verses = [...new Set([reference.verse, ...reference.verses])].sort((first, second) => first - second);
  let book = books.find((item) => bookMatchesSlug(item.name, reference.bookName));
  if (!book) {
    const chapters = await query(`${reference.bookName} ${reference.chapter}:${verseSelection(verses)}`);
    const chapter = chapters.find((item) => item.abbreviation === DEFAULT_TRANSLATION &&
      item.chapter === reference.chapter && verses.every((number) => item.verses.some((verse) => verse.verse === number)));
    book = books.find((item) => item.nr === chapter?.book_nr);
  }
  if (!book) throw new Error(`The daily Scripture book “${reference.bookName}” is unavailable.`);
  return { translation: DEFAULT_TRANSLATION, book: book.nr, bookName: book.name, chapter: reference.chapter, verse: reference.verse, verses };
}
