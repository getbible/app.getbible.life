import type { WholeTranslation } from "./getbible";

export type WordMode = "all" | "any" | "phrase";
export type MatchMode = "partial" | "exact";
export type SearchScope = "all" | "ot" | "nt" | `book:${number}`;

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

export function searchVerses(corpus: SearchVerse[], rawQuery: string, options: SearchOptions): SearchVerse[] {
  const query = rawQuery.trim();
  if (!query) return [];
  const locale = options.locale || "und";
  const normalize = (value: string) => options.caseSensitive ? value.normalize("NFC") : value.normalize("NFC").toLocaleLowerCase(locale);
  const normalizedQuery = normalize(query);
  const queryWords = words(normalizedQuery, locale);
  if (!queryWords.length) return [];

  return corpus.filter((verse) => {
    if (!inScope(verse, options.scope)) return false;
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
  });
}
