import type { WholeTranslation } from "./getbible";

export type WordMode = "all" | "any" | "phrase";
export type MatchMode = "partial" | "exact";
export type SearchScope = "all" | "ot" | "nt" | `book:${number}`;
export const SEARCH_ARRIVAL_MS = 7_000;

export interface SearchVerse {
  book: number;
  bookName: string;
  chapter: number;
  verse: number;
  reference: string;
  text: string;
}

export interface SearchOptions {
  words: WordMode;
  match: MatchMode;
  caseSensitive: boolean;
  scope: SearchScope;
  locale?: string;
}

export interface HighlightSegment { text: string; highlighted: boolean }
export type SearchHighlightOptions = Pick<SearchOptions, "match" | "caseSensitive" | "locale"> & { diacritics?: "fold" | "exact" };
export interface SearchPage { results: SearchVerse[]; nextCursor: number; complete: boolean }

export function flattenTranslation(translation: WholeTranslation): SearchVerse[] {
  return translation.books.flatMap((book) => book.chapters.flatMap((chapter) =>
    chapter.verses.map((verse) => ({
      book: book.nr,
      bookName: book.name,
      chapter: chapter.chapter,
      verse: verse.verse,
      reference: verse.name || `${book.name} ${chapter.chapter}:${verse.verse}`,
      text: verse.text,
    })),
  ));
}

function words(value: string, locale: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
    return [...segmenter.segment(value)].filter((part) => part.isWordLike).map((part) => part.segment);
  }
  return value.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
}

function inScope(verse: SearchVerse, scope: SearchScope): boolean {
  if (scope === "all") return true;
  if (scope === "ot") return verse.book <= 39;
  if (scope === "nt") return verse.book > 39;
  return verse.book === Number(scope.slice(5));
}

function verseMatches(verse: SearchVerse, rawQuery: string, options: SearchOptions): boolean {
  const query = rawQuery.trim();
  if (!query || !inScope(verse, options.scope)) return false;
  const locale = options.locale || "und";
  const normalize = (value: string) => options.caseSensitive ? value.normalize("NFC") : value.normalize("NFC").toLocaleLowerCase(locale);
  const normalizedQuery = normalize(query);
  const queryWords = words(normalizedQuery, locale);
  if (!queryWords.length) return false;
  const text = normalize(verse.text);
  const verseWords = words(text, locale);
  if (options.words === "phrase") {
    if (options.match === "partial") return text.includes(normalizedQuery);
    return queryWords.length <= verseWords.length && verseWords.some((_, start) =>
      queryWords.every((word, offset) => verseWords[start + offset] === word),
    );
  }
  const contains = (term: string) => options.match === "exact"
    ? verseWords.includes(term)
    : verseWords.some((word) => word.includes(term));
  return options.words === "all" ? queryWords.every(contains) : queryWords.some(contains);
}

export function searchVersePage(
  corpus: SearchVerse[],
  rawQuery: string,
  options: SearchOptions,
  cursor = 0,
  limit = 20,
  scanLimit = Number.POSITIVE_INFINITY,
): SearchPage {
  const results: SearchVerse[] = [];
  let index = Math.max(0, cursor);
  const stop = Math.min(corpus.length, index + scanLimit);
  for (; index < stop && results.length < limit; index += 1) {
    if (verseMatches(corpus[index], rawQuery, options)) results.push(corpus[index]);
  }
  return { results, nextCursor: index, complete: index >= corpus.length };
}

export async function searchVersePageAsync(
  corpus: SearchVerse[],
  rawQuery: string,
  options: SearchOptions,
  cursor = 0,
  limit = 20,
  cancelled: () => boolean = () => false,
): Promise<SearchPage> {
  const results: SearchVerse[] = [];
  let nextCursor = cursor;
  let complete = false;
  while (results.length < limit && !complete && !cancelled()) {
    const page = searchVersePage(corpus, rawQuery, options, nextCursor, limit - results.length, 400);
    results.push(...page.results);
    nextCursor = page.nextCursor;
    complete = page.complete;
    if (!complete && results.length < limit) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { results, nextCursor, complete };
}

export function searchVerses(corpus: SearchVerse[], rawQuery: string, options: SearchOptions): SearchVerse[] {
  return corpus.filter((verse) => verseMatches(verse, rawQuery, options));
}

export function highlightSearchText(
  text: string,
  rawQuery: string,
  options: SearchHighlightOptions,
): HighlightSegment[] {
  const locale = options.locale || "und";
  const normalize = (value: string) => {
    const normalized = options.diacritics === "fold"
      ? value.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC")
      : value.normalize("NFC");
    return options.caseSensitive ? normalized : normalized.toLocaleLowerCase(locale);
  };
  const terms = words(normalize(rawQuery), locale);
  if (!terms.length) return [{ text, highlighted: false }];
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(locale, { granularity: "word" }) : null;
  // Segment the original text and normalize comparisons only. Folded Unicode
  // can have a different length; slicing it would shift annotation offsets or
  // separate a combining mark from its highlighted word.
  const parts = segmenter ? segmenter.segment(text) : Array.from(text.matchAll(/[\p{L}\p{N}\p{M}]+/gu), (part) => ({
    segment: part[0], index: part.index!, isWordLike: true,
  }));
  const result: HighlightSegment[] = [];
  let cursor = 0;
  for (const part of parts) {
    if (!part.isWordLike) continue;
    if (part.index > cursor) result.push({ text: text.slice(cursor, part.index), highlighted: false });
    const token = normalize(part.segment);
    const highlighted = terms.some((term) => options.match === "exact" ? token === term : token.includes(term));
    result.push({ text: part.segment, highlighted });
    cursor = part.index + part.segment.length;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor), highlighted: false });
  return result.length ? result : [{ text, highlighted: false }];
}
