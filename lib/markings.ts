import type { Passage } from "./getbible";
import type { VerseNote } from "./notes";

export interface MarkingColor {
  id: string;
  name: string;
  value: string;
  /** A topic can retain its original local ID and custom color after migration. */
  source?: { type: "shared-bookmark"; topicId: string };
}

export interface Marking {
  id: string;
  passage: Passage;
  verse: number;
  start: number | null;
  end: number | null;
  quote: string;
  reference?: string;
  colorId: string;
  createdAt: number;
  source?: { type: "shared-bookmark"; topicId: string };
}

export interface MarkedSegment {
  start: number;
  end: number;
  text: string;
  colorId: string | null;
}

export function compareMarkings(left: Marking, right: Marking): number {
  return (
    left.passage.book - right.passage.book ||
    left.passage.chapter - right.passage.chapter ||
    left.verse - right.verse ||
    (left.start ?? -1) - (right.start ?? -1) ||
    left.createdAt - right.createdAt
  );
}

export interface MarkingsBackup {
  version: 1 | 2;
  exportedAt: string;
  colors: MarkingColor[];
  markings: Marking[];
  notes?: VerseNote[];
}

export function markingIdentity(marking: Marking): string {
  if (marking.start === null && marking.end === null) {
    return [canonicalPassageKey(marking.passage), marking.verse, isSharedBookmarkMarking(marking) ? "shared" : "all", marking.colorId].join("|");
  }
  return [passageKey(marking.passage), marking.verse, marking.start, marking.end, marking.quote, marking.colorId].join("|");
}

export function mergeMarkings(current: Marking[], imported: Marking[]): Marking[] {
  const seen = new Set(current.map(markingIdentity));
  const ids = new Set(current.map((marking) => marking.id));
  const merged = [...current];
  for (const marking of imported) {
    const key = markingIdentity(marking);
    if (!seen.has(key)) {
      let id = marking.id;
      let suffix = 1;
      while (ids.has(id)) id = `${marking.id}-imported-${suffix++}`;
      merged.push({ ...marking, id });
      seen.add(key);
      ids.add(id);
    }
  }
  return merged;
}

export function mergeColors(current: MarkingColor[], imported: MarkingColor[]): MarkingColor[] {
  const merged = [...current];
  const ids = new Set(current.map((color) => color.id));
  for (const color of imported) {
    if (!ids.has(color.id)) {
      merged.push(color);
      ids.add(color.id);
    }
  }
  return merged;
}

export function parseMarkingsBackup(value: unknown): MarkingsBackup {
  if (!value || typeof value !== "object") throw new Error("This is not a getBible.Life markings backup.");
  const backup = value as Partial<MarkingsBackup>;
  if ((backup.version !== 1 && backup.version !== 2) || !Array.isArray(backup.colors) || !Array.isArray(backup.markings)) {
    throw new Error("This markings backup has an unsupported format.");
  }
  const colorsValid = backup.colors.every((color) => color && typeof color.id === "string" && typeof color.name === "string" && /^#[0-9a-f]{6}$/i.test(color.value) && (color.source === undefined || validSharedBookmarkTopicSource(color.source)));
  const markingsValid = backup.markings.every((marking) => marking && typeof marking.id === "string" && typeof marking.colorId === "string" && typeof marking.verse === "number" && typeof marking.quote === "string" && typeof marking.createdAt === "number" && marking.passage && typeof marking.passage.translation === "string" && typeof marking.passage.book === "number" && typeof marking.passage.chapter === "number" && (marking.source === undefined || validSharedBookmarkSource(marking)));
  const notesValid = backup.notes === undefined || (Array.isArray(backup.notes) && backup.notes.every((note) => note && typeof note.id === "string" && typeof note.text === "string" && typeof note.verse === "number" && typeof note.reference === "string" && typeof note.createdAt === "number" && typeof note.updatedAt === "number" && note.passage && typeof note.passage.translation === "string" && typeof note.passage.book === "number" && typeof note.passage.chapter === "number"));
  if (!colorsValid || !markingsValid || !notesValid) throw new Error("This markings backup contains invalid data.");
  return backup as MarkingsBackup;
}

export function passageKey(passage: Passage): string {
  return `${passage.translation}/${passage.book}/${passage.chapter}`;
}

export function canonicalPassageKey(passage: Passage): string {
  return `${passage.book}/${passage.chapter}`;
}

export function markingMatchesPassage(
  marking: Marking,
  passage: Passage,
): boolean {
  return marking.start === null && marking.end === null
    ? canonicalPassageKey(marking.passage) === canonicalPassageKey(passage)
    : passageKey(marking.passage) === passageKey(passage);
}

function validSharedBookmarkTopicSource(source: unknown): source is NonNullable<MarkingColor["source"]> {
  if (!source || typeof source !== "object") return false;
  const value = source as Partial<NonNullable<MarkingColor["source"]>>;
  return value.type === "shared-bookmark" && typeof value.topicId === "string" &&
    value.topicId.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.topicId);
}

function validSharedBookmarkSource(marking: Marking): boolean {
  // Migrated topics retain local group IDs, so provenance belongs to the mark
  // itself rather than being inferred from its color ID.
  return validSharedBookmarkTopicSource(marking.source) && marking.start === null && marking.end === null;
}

/** Shared topic associations survive personal highlighting and remain independently deletable in their group. */
export function isSharedBookmarkMarking(marking: Marking): boolean {
  if (marking.start !== null || marking.end !== null) return false;
  if (validSharedBookmarkSource(marking)) return true;
  // Preserve earlier imports/backups that predate source metadata. Restrict the
  // fallback to the exact deterministic source ID, not every mark in its group.
  if (marking.source !== undefined || !marking.colorId.startsWith("getbible-topic:")) return false;
  const topicId = marking.colorId.slice("getbible-topic:".length);
  return topicId.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topicId) &&
    marking.id === `${marking.colorId}:${marking.passage.book}:${marking.passage.chapter}:${marking.verse}`;
}

export function personalWholeVerseMarking(markings: Marking[]): Marking | null {
  return [...markings].reverse().find((marking) => marking.start === null && marking.end === null && !isSharedBookmarkMarking(marking)) ?? null;
}

/** A personal highlight takes visual precedence, regardless of when a topic was imported. */
export function wholeVerseMarking(markings: Marking[]): Marking | null {
  return personalWholeVerseMarking(markings) ?? [...markings].reverse().find((marking) => marking.start === null && marking.end === null) ?? null;
}

export function withoutWholeVerseMarking(
  markings: Marking[],
  passage: Passage,
  verse: number,
): Marking[] {
  return markings.filter(
    (marking) =>
      !(
        marking.verse === verse &&
        marking.start === null &&
        marking.end === null &&
        !isSharedBookmarkMarking(marking) &&
        canonicalPassageKey(marking.passage) === canonicalPassageKey(passage)
      ),
  );
}

function textMarkingOverlapsSelection(
  marking: Marking,
  passage: Passage,
  verse: number,
  start: number,
  end: number,
): boolean {
  return (
    marking.verse === verse &&
    marking.start !== null &&
    marking.end !== null &&
    passageKey(marking.passage) === passageKey(passage) &&
    marking.start < end &&
    marking.end > start
  );
}

export function textSelectionHasMarking(
  markings: Marking[],
  passage: Passage,
  verse: number,
  start: number,
  end: number,
): boolean {
  return markings.some((marking) =>
    textMarkingOverlapsSelection(marking, passage, verse, start, end),
  );
}

export function withoutTextSelectionMarkings(
  markings: Marking[],
  passage: Passage,
  verse: number,
  start: number,
  end: number,
): Marking[] {
  return markings.filter(
    (marking) =>
      !textMarkingOverlapsSelection(marking, passage, verse, start, end),
  );
}

export function markedSegments(
  text: string,
  markings: Marking[],
): MarkedSegment[] {
  const ranged = markings
    .filter(
      (marking) =>
        marking.start !== null &&
        marking.end !== null &&
        marking.start >= 0 &&
        marking.end > marking.start &&
        marking.start < text.length,
    )
    .map((marking) => ({
      ...marking,
      start: marking.start as number,
      end: Math.min(marking.end as number, text.length),
    }));

  if (!ranged.length) {
    return [{ start: 0, end: text.length, text, colorId: null }];
  }

  const boundaries = new Set<number>([0, text.length]);
  for (const marking of ranged) {
    boundaries.add(marking.start);
    boundaries.add(marking.end);
  }

  const points = [...boundaries].sort((left, right) => left - right);
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const active = ranged
      .filter((marking) => marking.start <= start && marking.end >= end)
      .sort((left, right) => left.createdAt - right.createdAt)
      .at(-1);

    return {
      start,
      end,
      text: text.slice(start, end),
      colorId: active?.colorId ?? null,
    };
  });
}

export function translucentColor(value: string, opacity = "45"): string {
  return /^#[a-f0-9]{6}$/i.test(value) ? `${value}${opacity}` : value;
}
