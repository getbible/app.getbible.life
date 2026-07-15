import type { Passage } from "./getbible";

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

export const DEFAULT_MARKING_COLORS: MarkingColor[] = [
  { id: "yellow", name: "Promises", value: "#fde68a" },
  { id: "green", name: "Growth", value: "#bbf7d0" },
  { id: "blue", name: "Study", value: "#bfdbfe" },
  { id: "pink", name: "Prayer", value: "#fbcfe8" },
];

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
