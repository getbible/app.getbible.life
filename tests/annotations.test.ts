import assert from "node:assert/strict";
import test from "node:test";
import {
  annotationClasses, buildAnnotatedSegments, displayWords, getVerseHeadings,
  isParagraphStart, spanDetails, strongIdentifiers, tokenDetails,
  verseSourceAnnotations, type AnnotatedVerse, type EditorialChapter,
} from "../lib/annotations.ts";
import type { Marking } from "../lib/markings.ts";

const verse = (text: string): AnnotatedVerse => ({ chapter: 3, verse: 16, name: "John 3:16", text });
const marking = (start: number, end: number, colorId: string, createdAt = 1): Marking => ({
  id: `${start}-${end}-${colorId}`, passage: { translation: "kjv", book: 43, chapter: 3 },
  verse: 16, start, end, quote: "", colorId, createdAt,
});

test("v3 word positions keep exact display text and UTF-16 selection offsets", () => {
  const text = "God\tso  loved\n🌍 κόσμον.\u00a0End";
  const words = displayWords(text);
  assert.deepEqual(words.map((word) => word.text), ["God", "so", "loved", "🌍", "κόσμον.", "End"]);
  assert.equal(words[4].index, 5);
  for (const word of words) assert.equal(text.slice(word.start, word.end), word.text);
  const segments = buildAnnotatedSegments(verse(text));
  assert.equal(segments.map((segment) => segment.text).join(""), text);
  for (const segment of segments) assert.equal(text.slice(segment.start, segment.end), segment.text);
});

test("multiword lexical tokens attach by display range without reconstructing token text", () => {
  const source: AnnotatedVerse = {
    ...verse("For God so loved the world,"),
    tokens: [{ token: "the world", word_start: 5, word_end: 6, lemma: { strong: ["G3588", "G2889"], "lemma.TR": ["τον", "κοσμον"] }, morph: { robinson: ["T-ASM", "N-ASM"] } }],
    spans: [],
  };
  const segments = buildAnnotatedSegments(source);
  assert.equal(segments.map((segment) => segment.text).join(""), source.text);
  assert.equal(segments.find((segment) => segment.text === "the")?.tokens[0].token, "the world");
  const world = segments.find((segment) => segment.text === "world,");
  assert.deepEqual(strongIdentifiers(world?.tokens ?? []), ["G3588", "G2889"]);
  assert.deepEqual(tokenDetails(world?.tokens ?? []), ["Lemma (strong): G3588, G2889", "Lemma (lemma.TR): τον, κοσμον", "Morphology (robinson): T-ASM, N-ASM"]);
});

test("mark and search boundaries preserve complete words and exact text", () => {
  const source: AnnotatedVerse = {
    ...verse("the world, the word"),
    tokens: [{ token: "the world", word_start: 1, word_end: 2, lemma: { strong: ["G2889"] } }],
    spans: [{ tag: "q", span: "the world, the word", token_start: 0, token_end: 0, word_start: 1, word_end: 4, attrs: { who: "Jesus" } }],
  };
  const segments = buildAnnotatedSegments(source, [marking(5, 8, "yellow"), marking(6, 9, "blue", 2)], { query: "world", match: "exact", caseSensitive: false, locale: "en" });
  assert.equal(segments.map((segment) => segment.text).join(""), source.text);
  const world = segments.filter((segment) => segment.word?.index === 2);
  assert.equal(world.map((segment) => segment.text).join(""), "world,");
  assert.equal(world[0].word?.text, "world,");
  assert.equal(segments.filter((segment) => segment.searched).map((segment) => segment.text).join(""), "world");
  assert.equal(segments.filter((segment) => segment.colorId === "blue").map((segment) => segment.text).join(""), "rld");
  assert.ok(world.every((segment) => annotationClasses(segment.spans).includes("scripture-jesus")));
});

test("display-word span coordinates are one-based and independent of token indices", () => {
  const source: AnnotatedVerse = {
    ...verse("And now abideth faith, hope, charity, these three; but the greatest of these is charity."),
    tokens: [],
    spans: [{ tag: "transChange", span: "is", token_start: 11, token_end: 11, word_start: 14, word_end: 14, attrs: { type: "added" } }],
  };
  const added = buildAnnotatedSegments(source).filter((segment) => annotationClasses(segment.spans).includes("scripture-supplied"));
  assert.equal(added.map((segment) => segment.text).join(""), "is");
  assert.deepEqual(spanDetails(added[0].spans), ["Word supplied by the translation"]);
});

test("unlocated and invalid source coordinates never decorate arbitrary display words", () => {
  const source: AnnotatedVerse = {
    ...verse("For God"),
    tokens: [
      { token: "absent", word_start: 0, word_end: 0, lemma: { strong: ["G1"] } },
      { token: "outside", word_start: 1, word_end: 9, lemma: { strong: ["G2"] } },
    ],
    spans: [{ tag: "transChange", span: "unlocated", token_start: 0, token_end: 0, word_start: 0, word_end: 0, attrs: { type: "added" } }],
  };
  const segments = buildAnnotatedSegments(source);
  assert.ok(segments.every((segment) => !segment.tokens.length && !segment.spans.length));
  const annotations = verseSourceAnnotations(source);
  assert.equal(annotations.length, 3);
  assert.equal(annotations[0].text, "unlocated");
  assert.equal(annotations[1].text, "absent");
});

test("speaker and reference source details remain separate from scripture text", () => {
  const source: AnnotatedVerse = {
    ...verse("For God"),
    tokens: [],
    spans: [
      { tag: "q", span: "For God", token_start: 0, token_end: 0, word_start: 1, word_end: 2, attrs: { who: "Jesus" } },
      { tag: "note", span: "Compare another passage.", token_start: 0, token_end: 0, word_start: 0, word_end: 0, attrs: { osisRef: "John.1.1" } },
      { tag: "reference", span: "Unsafe link", token_start: 0, token_end: 0, word_start: 0, word_end: 0, attrs: { target: "javascript:alert(1)" } },
    ],
  };
  assert.equal(buildAnnotatedSegments(source).map((segment) => segment.text).join(""), "For God");
  const annotations = verseSourceAnnotations(source);
  assert.equal(annotations[0].label, "Speaker: Jesus");
  assert.equal(annotations[0].text, "");
  assert.deepEqual(annotations[1].references, ["John.1.1"]);
  assert.deepEqual(annotations[2].references, []);
});

test("editorial headings stay ordered at their anchored verses and paragraphs use emitted numbering", () => {
  const chapter: EditorialChapter = { editorial: [
    { order: 3, type: "heading", anchor: { verse: 16, edge: "before" }, text: "Second heading", heading_type: "section", canonical: false },
    { order: 0, type: "heading", anchor: { verse: 1, edge: "before" }, text: "CHAPTER 3.", heading_type: "chapter", canonical: false },
    { order: 2, type: "heading", anchor: { verse: 16, edge: "before" }, text: "First heading", heading_type: "section", canonical: true },
    { order: 1, type: "paragraph", start: 1, end: 15 },
    { order: 4, type: "paragraph", start: 16, end: 21 },
  ] };
  assert.deepEqual(getVerseHeadings(chapter, 16).map((heading) => heading.text), ["First heading", "Second heading"]);
  assert.deepEqual(getVerseHeadings(chapter, 2), []);
  assert.equal(isParagraphStart(chapter, verse("text")), true);
  assert.equal(isParagraphStart(chapter, { ...verse("text"), verse: 17 }), false);
  assert.equal(isParagraphStart({}, { ...verse("text"), paragraph: true }), true);
});

test("plain and empty source text need no fabricated metadata", () => {
  assert.deepEqual(buildAnnotatedSegments(verse("")), []);
  assert.deepEqual(verseSourceAnnotations(verse("plain text")), []);
  assert.equal(buildAnnotatedSegments(verse("  \n")).map((segment) => segment.text).join(""), "  \n");
});
