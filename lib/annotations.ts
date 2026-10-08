import type { Editorial, Span, Token, Verse } from "./getbible.ts";
import { markedSegments, type Marking } from "./markings.ts";
import { highlightSearchText, type MatchMode } from "./search.ts";

/** Positions refer to the untouched display text, never to source token strings. */
export interface DisplayWord {
  index: number;
  start: number;
  end: number;
  text: string;
}

export type ScriptureToken = Token;
export type ScriptureSpan = Span;
export type AnnotatedVerse = Verse;
export type EditorialHeading = Extract<Editorial, { type: "heading" }>;
export type EditorialParagraph = Extract<Editorial, { type: "paragraph" }>;

export interface EditorialChapter {
  editorial?: (EditorialHeading | EditorialParagraph)[];
}

export interface AnnotationSearch {
  query: string;
  match: MatchMode;
  caseSensitive: boolean;
  locale?: string;
}

export interface AnnotatedSegment {
  start: number;
  end: number;
  text: string;
  word: DisplayWord | null;
  tokens: ScriptureToken[];
  spans: ScriptureSpan[];
  colorId: string | null;
  searched: boolean;
}

export interface SourceAnnotation {
  id: string;
  label: string;
  text: string;
  details: string[];
  references: string[];
}

/** v3 word positions are one-based whitespace words. JS offsets match Range text lengths. */
export function displayWords(text: string): DisplayWord[] {
  return [...text.matchAll(/\S+/gu)].map((match, index) => ({
    index: index + 1,
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
  }));
}

function locatedRange(value: { word_start: number; word_end: number }, count: number): boolean {
  return Number.isInteger(value.word_start) && Number.isInteger(value.word_end)
    && value.word_start >= 1 && value.word_end >= value.word_start && value.word_end <= count;
}

function coversWord(value: { word_start: number; word_end: number }, word: number): boolean {
  return value.word_start <= word && value.word_end >= word;
}

/**
 * Intersect display-word, saved-marking and search boundaries without replacing a
 * single character. Token ranges deliberately never become character offsets.
 */
export function buildAnnotatedSegments(
  verse: AnnotatedVerse,
  markings: Marking[] = [],
  search?: AnnotationSearch,
): AnnotatedSegment[] {
  const text = verse.text;
  if (!text.length) return [];
  const words = displayWords(text);
  const tokens = (verse.tokens ?? []).filter((token) => locatedRange(token, words.length));
  const spans = (verse.spans ?? []).filter((span) => locatedRange(span, words.length));
  const marked = markedSegments(text, markings);
  let cursor = 0;
  const searched = (search ? highlightSearchText(text, search.query, search) : [{ text, highlighted: false }])
    .map((segment) => {
      const start = cursor;
      cursor += segment.text.length;
      return { start, end: cursor, highlighted: segment.highlighted };
    });
  const boundaries = new Set([0, text.length]);
  for (const range of [...words, ...marked, ...searched]) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }
  const points = [...boundaries].sort((left, right) => left - right);
  let wordIndex = 0;
  let markedIndex = 0;
  let searchIndex = 0;
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    while (wordIndex < words.length && words[wordIndex].end <= start) wordIndex += 1;
    while (markedIndex < marked.length - 1 && marked[markedIndex].end <= start) markedIndex += 1;
    while (searchIndex < searched.length - 1 && searched[searchIndex].end <= start) searchIndex += 1;
    const candidate = words[wordIndex];
    const word = candidate && candidate.start <= start && candidate.end >= end ? candidate : null;
    return {
      start, end, text: text.slice(start, end), word,
      tokens: word ? tokens.filter((token) => coversWord(token, word.index)) : [],
      spans: word ? spans.filter((span) => coversWord(span, word.index)) : [],
      colorId: marked[markedIndex]?.colorId ?? null,
      searched: searched[searchIndex]?.highlighted ?? false,
    };
  });
}

export function strongIdentifiers(tokens: ScriptureToken[]): string[] {
  return [...new Set(tokens.flatMap((token) => token.lemma?.strong ?? []))];
}

function groupedDetails(label: string, value?: Record<string, string[]>): string[] {
  return Object.entries(value ?? {}).map(([scheme, values]) => `${label} (${scheme}): ${values.join(", ")}`);
}

export function tokenDetails(tokens: ScriptureToken[]): string[] {
  return [...new Set(tokens.flatMap((token) => [
    ...groupedDetails("Lemma", token.lemma),
    ...groupedDetails("Morphology", token.morph),
    ...groupedDetails("Transliteration", token.xlit),
    ...(token.gloss ? [`Gloss: ${token.gloss}`] : []),
    ...(token.variant ? [`Source variant${token.variantType ? `: ${token.variantType}` : ""}`] : []),
  ]))];
}

function isAdded(span: ScriptureSpan): boolean {
  return span.tag === "transChange" && span.attrs?.type === "added";
}

function isJesusSpeaker(span: ScriptureSpan): boolean {
  return /^#?jesus$/iu.test(span.attrs?.who?.trim() ?? "");
}

export function annotationClasses(spans: ScriptureSpan[]): string[] {
  const classes: string[] = [];
  if (spans.some(isAdded)) classes.push("scripture-supplied");
  if (spans.some((span) => span.tag === "q" && isJesusSpeaker(span))) classes.push("scripture-jesus");
  if (spans.some((span) => span.tag === "divineName")) classes.push("scripture-divine-name");
  if (spans.some((span) => span.tag === "hi" && /^(italic|italics)$/iu.test(span.attrs?.type ?? ""))) classes.push("scripture-italic");
  if (spans.some((span) => span.tag === "hi" && /^(bold|boldface)$/iu.test(span.attrs?.type ?? ""))) classes.push("scripture-bold");
  return classes;
}

export function spanDetails(spans: ScriptureSpan[]): string[] {
  return [...new Set(spans.flatMap((span) => {
    if (isAdded(span)) return ["Word supplied by the translation"];
    if (span.tag === "divineName") return ["Divine name"];
    if (span.attrs?.who) return isJesusSpeaker(span) ? [] : [`Speaker: ${span.attrs.who}`];
    return [span.tag, ...Object.entries(span.attrs ?? {}).map(([name, value]) => `${name}: ${value}`)];
  }))];
}

function spanReferences(span: ScriptureSpan): string[] {
  const attrs = span.attrs ?? {};
  return [...new Set([attrs.osisRef, attrs.ref, attrs.reference, attrs.target]
    .filter((value): value is string => Boolean(value?.trim()))
    .filter((value) => !/^(?:https?:|javascript:|#)/iu.test(value)))];
}

/** Source notes stay outside the selectable scripture text, so marks keep their offsets. */
export function verseSourceAnnotations(verse: AnnotatedVerse): SourceAnnotation[] {
  const count = displayWords(verse.text).length;
  const annotations: SourceAnnotation[] = [];
  for (const [index, span] of (verse.spans ?? []).entries()) {
    const tag = span.tag.toLowerCase();
    const references = spanReferences(span);
    const isNote = ["note", "footnote", "reference", "ref", "crossref", "crossreference"].includes(tag);
    // Red text already identifies Jesus. Keep real notes and references, but
    // avoid repeating the speaker as a separate annotation or word tooltip.
    const isSpeaker = Boolean(span.attrs?.who) && !isJesusSpeaker(span);
    if (isJesusSpeaker(span) && !isNote && !references.length) continue;
    if (!isNote && !isSpeaker && !references.length && locatedRange(span, count)) continue;
    const label = isSpeaker ? `Speaker: ${span.attrs?.who}` : references.length ? "Reference" : isNote ? "Source note" : "Source annotation";
    annotations.push({
      id: `span-${index}`, label, text: isSpeaker ? "" : span.span,
      details: spanDetails([span]).filter((detail) => detail !== label), references,
    });
  }
  for (const [index, token] of (verse.tokens ?? []).entries()) {
    if (locatedRange(token, count)) continue;
    annotations.push({ id: `token-${index}`, label: "Unlocated source word", text: token.token, details: tokenDetails([token]), references: [] });
  }
  return annotations;
}

export function getVerseHeadings(chapter: EditorialChapter, verse: number): EditorialHeading[] {
  return (chapter.editorial ?? []).filter((entry): entry is EditorialHeading =>
    entry.type === "heading" && entry.anchor.edge === "before" && entry.anchor.verse === verse)
    .sort((left, right) => left.order - right.order);
}

export function isParagraphStart(chapter: EditorialChapter, verse: AnnotatedVerse): boolean {
  return verse.paragraph === true || (chapter.editorial ?? []).some((entry) => entry.type === "paragraph" && entry.start === verse.verse);
}
