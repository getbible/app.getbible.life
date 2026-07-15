import type { Passage } from "./getbible";
import { DEPLOYMENT_MARKING_COLORS } from "../config/reader.ts";

export interface MarkingColor {
  id: string;
  name: string;
  value: string;
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

export const DEFAULT_MARKING_COLORS: MarkingColor[] = DEPLOYMENT_MARKING_COLORS;

export interface MarkingsBackup {
  version: 1;
  exportedAt: string;
  colors: MarkingColor[];
  markings: Marking[];
}

export function markingIdentity(marking: Marking): string {
  return [passageKey(marking.passage), marking.verse, marking.start ?? "all", marking.end ?? "all", marking.quote, marking.colorId].join("|");
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
  if (backup.version !== 1 || !Array.isArray(backup.colors) || !Array.isArray(backup.markings)) {
    throw new Error("This markings backup has an unsupported format.");
  }
  const colorsValid = backup.colors.every((color) => color && typeof color.id === "string" && typeof color.name === "string" && /^#[0-9a-f]{6}$/i.test(color.value));
  const markingsValid = backup.markings.every((marking) => marking && typeof marking.id === "string" && typeof marking.colorId === "string" && typeof marking.verse === "number" && typeof marking.quote === "string" && typeof marking.createdAt === "number" && marking.passage && typeof marking.passage.translation === "string" && typeof marking.passage.book === "number" && typeof marking.passage.chapter === "number");
  if (!colorsValid || !markingsValid) throw new Error("This markings backup contains invalid data.");
  return backup as MarkingsBackup;
}

export function passageKey(passage: Passage): string {
  return `${passage.translation}/${passage.book}/${passage.chapter}`;
}

export function markingMatchesPassage(
  marking: Marking,
  passage: Passage,
): boolean {
  return passageKey(marking.passage) === passageKey(passage);
}

export function wholeVerseMarking(markings: Marking[]): Marking | null {
  return (
    [...markings]
      .reverse()
      .find((marking) => marking.start === null && marking.end === null) ?? null
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
