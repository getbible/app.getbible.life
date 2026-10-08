import type { Marking, MarkingColor } from "./markings";

export type BookmarkCoordinate = [book: number, chapter: number, verse: number];

export interface ImportableBookmarkTopic {
  id: string;
  name: string;
  color: string;
  names?: Record<string, string>;
  verses: BookmarkCoordinate[];
}

// The shared catalog uses the documented 66-book canon, independently of the
// reader's selected translation. Query v3 accepts these names, not numeric IDs.
const BOOK_NAMES = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua",
  "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
  "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job",
  "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah",
  "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel",
  "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah",
  "Haggai", "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John",
  "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians",
  "Ephesians", "Philippians", "Colossians", "1 Thessalonians",
  "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon",
  "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John",
  "Jude", "Revelation",
] as const;

const CHAPTER_COUNTS = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42,
  150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14,
  4, 28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13,
  5, 5, 3, 5, 1, 1, 1, 22,
] as const;

function isCoordinate(value: unknown): value is BookmarkCoordinate {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isSafeInteger)) return false;
  const [book, chapter, verse] = value as number[];
  return book >= 1 && book <= 66 && chapter >= 1 && chapter <= CHAPTER_COUNTS[book - 1] && verse >= 1 && verse <= 2000;
}

/** Validate the entire source before producing an import; never partially import malformed topics. */
export function bookmarkCoordinates(value: unknown): BookmarkCoordinate[] {
  if (!Array.isArray(value) || value.length > 100000 || !value.every(isCoordinate)) {
    throw new Error("This shared topic contains invalid Scripture coordinates.");
  }
  const unique = new Map<string, BookmarkCoordinate>();
  for (const coordinate of value) unique.set(coordinate.join(":"), [...coordinate]);
  return [...unique.values()].sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]);
}

export function bookmarkReference(coordinate: BookmarkCoordinate): string {
  if (!isCoordinate(coordinate)) throw new Error("Invalid Scripture coordinates.");
  return `${BOOK_NAMES[coordinate[0] - 1]} ${coordinate[1]}:${coordinate[2]}`;
}

/** Exact locale, base language, then English; partial catalogs never hide a topic. */
export function bookmarkTopicName(topic: { name: string; names?: Record<string, string> }, language: string): string {
  const locale = language.trim().toLowerCase().replaceAll("_", "-");
  return topic.names?.[locale] || topic.names?.[locale.split("-")[0]] || topic.names?.en || topic.name;
}

export function bookmarkTopicMatches(topic: { id: string; name: string; aliases?: string[]; names?: Record<string, string> }, query: string, language: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || [bookmarkTopicName(topic, language), topic.name, topic.id, ...(topic.aliases ?? [])]
    .some((name) => name.toLocaleLowerCase().includes(needle));
}

/**
 * One stable group per source topic. Whole-verse markings are canon based in
 * mergeMarkings, so reimports in another translation or locale are idempotent.
 */
export function importBookmarkTopic(topic: ImportableBookmarkTopic, translation: string, language: string, createdAt = Date.now()): { colors: MarkingColor[]; markings: Marking[] } {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic.id) || topic.id.length > 80 || !/^#[a-f0-9]{6}$/i.test(topic.color)) {
    throw new Error("This shared topic has invalid metadata.");
  }
  if (!/^[a-z0-9_-]+$/i.test(translation) || !Number.isFinite(createdAt) || createdAt < 0) {
    throw new Error("The selected translation or import timestamp is invalid.");
  }
  const coordinates = bookmarkCoordinates(topic.verses);
  const colorId = `getbible-topic:${topic.id}`;
  return {
    colors: [{ id: colorId, name: bookmarkTopicName(topic, language), value: topic.color }],
    markings: coordinates.map(([book, chapter, verse]) => ({
      id: `${colorId}:${book}:${chapter}:${verse}`,
      colorId,
      passage: { translation: translation.toLowerCase(), book, chapter },
      verse,
      start: null,
      end: null,
      quote: "",
      reference: bookmarkReference([book, chapter, verse]),
      createdAt,
      source: { type: "shared-bookmark", topicId: topic.id },
    })),
  };
}
