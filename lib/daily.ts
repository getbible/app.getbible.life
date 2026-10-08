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
}

function positiveNumber(value: unknown): number | null {
  const number = Number(String(value ?? "").match(/\d+/)?.[0]);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
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
  const referenceMatch = name.match(/^(.+?)\s+(\d+):(\d+)/);
  const scripture = Array.isArray(data.scripture) ? data.scripture as Array<Record<string, unknown>> : [];

  const translation = String(data.translation ?? data.version ?? path[0] ?? "kjv").toLowerCase();
  const bookName = String(data.book ?? path[1] ?? referenceMatch?.[1] ?? "").replaceAll("%20", " ");
  const chapter = positiveNumber(data.chapter ?? path[2] ?? referenceMatch?.[2]);
  const verse = positiveNumber(data.verse ?? data.verses ?? path[3] ?? referenceMatch?.[3] ?? scripture[0]?.nr);

  if (!date || !bookName || !chapter || !verse) throw new Error("The daily Scripture response does not contain a complete reference.");
  return { date, translation, bookName, chapter, verse };
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
): Promise<Passage & { bookName: string; verse: number }> {
  let book = books.find((item) => bookMatchesSlug(item.name, reference.bookName));
  if (!book) {
    const chapters = await query(`${reference.bookName} ${reference.chapter}:${reference.verse}`);
    const chapter = chapters.find((item) => item.abbreviation === DEFAULT_TRANSLATION &&
      item.chapter === reference.chapter && item.verses.some((verse) => verse.verse === reference.verse));
    book = books.find((item) => item.nr === chapter?.book_nr);
  }
  if (!book) throw new Error(`The daily Scripture book “${reference.bookName}” is unavailable.`);
  return { translation: DEFAULT_TRANSLATION, book: book.nr, bookName: book.name, chapter: reference.chapter, verse: reference.verse };
}
