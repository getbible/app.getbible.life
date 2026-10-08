import { canonicalPassageKey, compareMarkings, isSharedBookmarkMarking, markingIdentity, mergeMarkings, type Marking, type MarkingColor } from "./markings.ts";

export type BookmarkCoordinate = [book: number, chapter: number, verse: number];

export interface ImportableBookmarkTopic {
  id: string;
  name: string;
  color: string;
  names?: Record<string, string>;
  aliases?: string[];
  verses: BookmarkCoordinate[];
}

export type BookmarkTopicMetadata = Omit<ImportableBookmarkTopic, "verses">;

/** Both topics.json and all.json provide topic metadata; all.json adds locales. */
export interface BookmarkGroupCatalog {
  topics: BookmarkTopicMetadata[];
  locales?: Record<string, { topics: Record<string, string> }>;
}

export interface ImportableBookmarkCatalog extends BookmarkGroupCatalog {
  topics: ImportableBookmarkTopic[];
}

export interface BookmarkGroupMigration {
  colors: MarkingColor[];
  markings: Marking[];
  /** Includes unchanged IDs, so callers can remap selected and active groups. */
  colorIdMap: Record<string, string>;
}

export interface BookmarkMigrationPreview {
  matchingGroups: number;
  mergedGroups: number;
  retainedGroups: number;
  addedGroups: number;
  matches: Array<{ topicId: string; colorId: string; mergedColorIds: string[] }>;
}

export interface BookmarkDisplayRow {
  marking: Marking;
  /** All records represented by this row, for an explicit row removal. */
  ids: string[];
  global: boolean;
  personal: boolean;
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
  const needle = normalizeBookmarkTopicName(query);
  return !needle || [bookmarkTopicName(topic, language), topic.name, topic.id, ...(topic.aliases ?? []), ...Object.values(topic.names ?? {})]
    .some((name) => normalizeBookmarkTopicName(name).includes(needle));
}

/** Case, accents, punctuation and spacing never split otherwise identical topics. */
export function normalizeBookmarkTopicName(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function topicMetadata(topic: BookmarkTopicMetadata): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic.id) || topic.id.length > 80 ||
    typeof topic.name !== "string" || !topic.name.trim() || !/^#[a-f0-9]{6}$/i.test(topic.color) ||
    (topic.aliases !== undefined && (!Array.isArray(topic.aliases) || !topic.aliases.every((alias) => typeof alias === "string"))) ||
    (topic.names !== undefined && (!topic.names || typeof topic.names !== "object" || Array.isArray(topic.names) || !Object.values(topic.names).every((name) => typeof name === "string")))) {
    throw new Error("This shared topic has invalid metadata.");
  }
}

function catalogTopics(catalog: BookmarkGroupCatalog): BookmarkTopicMetadata[] {
  if (!catalog || !Array.isArray(catalog.topics)) throw new Error("This shared bookmark catalog is invalid.");
  const ids = new Set<string>();
  return catalog.topics.map((topic) => {
    topicMetadata(topic);
    if (ids.has(topic.id)) throw new Error("This shared bookmark catalog contains duplicate topics.");
    ids.add(topic.id);
    const names: Record<string, string> = { en: topic.name };
    for (const [locale, name] of Object.entries(topic.names ?? {})) names[locale.toLowerCase().replaceAll("_", "-")] = name;
    for (const [locale, document] of Object.entries(catalog.locales ?? {})) {
      const name = document?.topics?.[topic.id];
      if (typeof name === "string" && name.trim()) names[locale.toLowerCase().replaceAll("_", "-")] = name;
    }
    return { ...topic, names };
  });
}

function topicColor(topic: BookmarkTopicMetadata, language: string): MarkingColor {
  return {
    id: `getbible-topic:${topic.id}`,
    name: bookmarkTopicName(topic, language),
    value: topic.color,
    source: { type: "shared-bookmark", topicId: topic.id },
  };
}

/** Fresh installations start with the actual global catalog, without importing verses. */
export function bookmarkDefaultColors(catalog: BookmarkGroupCatalog, language: string): MarkingColor[] {
  return catalogTopics(catalog).map((topic) => topicColor(topic, language));
}

function matchedTopic(color: MarkingColor, topics: BookmarkTopicMetadata[]): BookmarkTopicMetadata | undefined {
  // Source IDs outrank labels: renaming a linked topic cannot sever its identity
  // or accidentally link it to a second topic with the same label.
  if (color.source) return topics.find((topic) => topic.id === color.source!.topicId);
  if (color.id.startsWith("getbible-topic:")) return topics.find((topic) => `getbible-topic:${topic.id}` === color.id);
  const byId = topics.find((topic) => topic.id === color.id);
  if (byId) return byId;
  const name = normalizeBookmarkTopicName(color.name);
  if (!name) return undefined;
  const canonical = topics.filter((topic) => [topic.name, ...Object.values(topic.names ?? {})].some((value) => normalizeBookmarkTopicName(value) === name));
  if (canonical.length) return canonical.length === 1 ? canonical[0] : undefined;
  const aliases = topics.filter((topic) => topic.aliases?.some((alias) => normalizeBookmarkTopicName(alias) === name));
  // Ambiguous aliases retain their local group instead of guessing a topic.
  return aliases.length === 1 ? aliases[0] : undefined;
}

function groupPlan(colors: MarkingColor[], catalog: BookmarkGroupCatalog, language: string) {
  const topics = catalogTopics(catalog);
  const groups = new Map<string, MarkingColor[]>();
  const topicByColor = new Map<string, BookmarkTopicMetadata>();
  for (const color of colors) {
    const topic = matchedTopic(color, topics);
    if (!topic) continue;
    topicByColor.set(color.id, topic);
    const associated = groups.get(topic.id) ?? [];
    associated.push(color);
    groups.set(topic.id, associated);
  }
  const survivors = new Map<string, MarkingColor>();
  const usedIds = new Set(colors.map((color) => color.id));
  for (const topic of topics) {
    const existing = groups.get(topic.id) ?? [];
    // Preserve a user's local group ID/name/color if it already matches, then
    // absorb an earlier imported group into it. No bookmark ID is rewritten.
    const survivor = existing.find((color) => !color.id.startsWith("getbible-topic:")) ?? existing[0];
    const next = survivor ? { ...survivor, source: { type: "shared-bookmark" as const, topicId: topic.id } } : topicColor(topic, language);
    if (!survivor) {
      const base = next.id;
      let suffix = 1;
      while (usedIds.has(next.id)) next.id = `${base}:${suffix++}`;
      usedIds.add(next.id);
    }
    survivors.set(topic.id, next);
  }
  return { topics, groups, topicByColor, survivors };
}

/** Describe the migration without changing local state or accepting it implicitly. */
export function bookmarkMigrationPreview(colors: MarkingColor[], catalog: BookmarkGroupCatalog, language: string): BookmarkMigrationPreview {
  const plan = groupPlan(colors, catalog, language);
  const matches = [...plan.groups].map(([topicId, associated]) => ({
    topicId,
    colorId: plan.survivors.get(topicId)!.id,
    mergedColorIds: associated.filter((color) => color.id !== plan.survivors.get(topicId)!.id).map((color) => color.id),
  }));
  return {
    matchingGroups: plan.topicByColor.size,
    mergedGroups: matches.reduce((count, match) => count + match.mergedColorIds.length, 0),
    retainedGroups: colors.length - plan.topicByColor.size,
    addedGroups: plan.topics.length - plan.groups.size,
    matches,
  };
}

/** Called only after a user's migration choice or their explicit download action. */
export function migrateBookmarkGroups(colors: MarkingColor[], markings: Marking[], catalog: BookmarkGroupCatalog, language: string): BookmarkGroupMigration {
  const plan = groupPlan(colors, catalog, language);
  const colorIdMap: Record<string, string> = Object.create(null);
  const nextColors: MarkingColor[] = [];
  const seen = new Set<string>();
  for (const color of colors) {
    const topic = plan.topicByColor.get(color.id);
    const survivor = topic ? plan.survivors.get(topic.id)! : color;
    colorIdMap[color.id] = survivor.id;
    if (!seen.has(survivor.id)) { nextColors.push(survivor); seen.add(survivor.id); }
  }
  for (const color of plan.survivors.values()) if (!seen.has(color.id)) { nextColors.push(color); seen.add(color.id); }
  const migrated = markings.map((marking) => {
    const colorId = colorIdMap[marking.colorId] ?? marking.colorId;
    // Legacy deterministic imports need explicit provenance before their old
    // global group ID is absorbed into a user's local topic.
    const source = marking.source ?? (isSharedBookmarkMarking(marking)
      ? { type: "shared-bookmark" as const, topicId: marking.colorId.slice("getbible-topic:".length) }
      : undefined);
    return colorId === marking.colorId && source === marking.source ? marking : { ...marking, colorId, ...(source ? { source } : {}) };
  });
  // Keep every personal record (including overlapping highlights and their
  // quotes); only collapse identical global memberships made by old imports.
  const globalIdentities = new Set<string>();
  const nextMarkings = migrated.filter((marking) => {
    if (!isSharedBookmarkMarking(marking)) return true;
    const identity = markingIdentity(marking);
    if (globalIdentities.has(identity)) return false;
    globalIdentities.add(identity);
    return true;
  });
  return { colors: nextColors, markings: nextMarkings, colorIdMap };
}

/** Fill the same groups the reader already uses, retaining all personal data. */
export function importBookmarkCatalog(colors: MarkingColor[], markings: Marking[], catalog: ImportableBookmarkCatalog, translation: string, language: string, createdAt = Date.now()): BookmarkGroupMigration {
  // Validate every coordinate before planning changes: a malformed catalog
  // must never leave the caller with a partially imported collection.
  const topics = catalog.topics.map((topic) => ({ ...topic, verses: bookmarkCoordinates(topic.verses) }));
  const migrated = migrateBookmarkGroups(colors, markings, { ...catalog, topics }, language);
  const groups = new Map(migrated.colors.filter((color) => color.source).map((color) => [color.source!.topicId, color.id]));
  const imported = topics.flatMap((topic) => importBookmarkTopic(topic, translation, language, createdAt).markings.map((marking) => ({ ...marking, colorId: groups.get(topic.id)! })));
  return { ...migrated, markings: mergeMarkings(migrated.markings, imported) };
}

/** A per-topic download uses exactly the same merge rules as the full catalog. */
export function importBookmarkTopicIntoGroups(colors: MarkingColor[], markings: Marking[], topic: ImportableBookmarkTopic, translation: string, language: string, createdAt = Date.now()): BookmarkGroupMigration {
  return importBookmarkCatalog(colors, markings, { topics: [topic] }, translation, language, createdAt);
}

/** Clear downloaded memberships while keeping personal marks and topic metadata. */
export function removeGlobalBookmarkMarkings(markings: Marking[], topicId?: string): Marking[] {
  return markings.filter((marking) => {
    if (!isSharedBookmarkMarking(marking)) return true;
    return topicId !== undefined && (marking.source?.topicId ?? marking.colorId.slice("getbible-topic:".length)) !== topicId;
  });
}

/** One visible verse per topic; storage keeps both personal and global origins. */
export function bookmarkDisplayRows(markings: Marking[]): BookmarkDisplayRow[] {
  const rows: BookmarkDisplayRow[] = [];
  const verses = new Map<string, BookmarkDisplayRow>();
  const preference = (marking: Marking) => (isSharedBookmarkMarking(marking) ? 0 : 2) + (marking.quote.trim() ? 1 : 0);
  for (const marking of markings) {
    const global = isSharedBookmarkMarking(marking);
    const key = marking.start === null && marking.end === null
      ? [marking.colorId, canonicalPassageKey(marking.passage), marking.verse].join("|")
      : null;
    const existing = key ? verses.get(key) : undefined;
    if (existing) {
      if (!existing.ids.includes(marking.id)) existing.ids.push(marking.id);
      existing.global ||= global;
      existing.personal ||= !global;
      if (preference(marking) > preference(existing.marking)) existing.marking = marking;
    } else {
      const row: BookmarkDisplayRow = { marking, ids: [marking.id], global, personal: !global };
      rows.push(row);
      if (key) verses.set(key, row);
    }
  }
  return rows.sort((left, right) =>
    left.marking.passage.book - right.marking.passage.book ||
    left.marking.passage.chapter - right.marking.passage.chapter ||
    left.marking.verse - right.marking.verse ||
    Number(right.global) - Number(left.global) ||
    compareMarkings(left.marking, right.marking),
  );
}

/**
 * One stable group per source topic. Whole-verse markings are canon based in
 * mergeMarkings, so reimports in another translation or locale are idempotent.
 */
export function importBookmarkTopic(topic: ImportableBookmarkTopic, translation: string, language: string, createdAt = Date.now()): { colors: MarkingColor[]; markings: Marking[] } {
  topicMetadata(topic);
  if (!/^[a-z0-9_-]+$/i.test(translation) || !Number.isFinite(createdAt) || createdAt < 0) {
    throw new Error("The selected translation or import timestamp is invalid.");
  }
  const coordinates = bookmarkCoordinates(topic.verses);
  const colorId = `getbible-topic:${topic.id}`;
  return {
    colors: [topicColor(topic, language)],
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
