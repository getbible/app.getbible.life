import assert from "node:assert/strict";
import test from "node:test";
import { WEEK_MS, fresh, parsePassage, passageSearch, translationValues, validSha, valuesByNumber } from "../lib/getbible.ts";
import { DEFAULT_MARKING_COLORS, compareMarkings, markedSegments, markingMatchesPassage, mergeColors, mergeMarkings, parseMarkingsBackup, passageKey, translucentColor, wholeVerseMarking } from "../lib/markings.ts";
import { EMPTY_BOUNDARY_SCROLL, registerBoundaryScroll } from "../lib/scroll-navigation.ts";

test("parses and sanitizes passage URLs",()=>{
  assert.deepEqual(parsePassage("?translation=AOV&book=19&chapter=23"),{translation:"aov",book:19,chapter:23});
  assert.deepEqual(parsePassage("?translation=../../bad&book=-1&chapter=no"),{translation:"kjv",book:43,chapter:3});
});

test("creates stable shareable queries",()=>{
  assert.equal(passageSearch({translation:"kjv",book:43,chapter:3}),"?translation=kjv&book=43&chapter=3");
});

test("sorts numbered API records numerically",()=>{
  assert.deepEqual(valuesByNumber({"10":"ten","2":"two","1":"one"}),["one","two","ten"]);
});

test("sorts translations by language then name",()=>{
  const list=translationValues({b:{translation:"Zulu",abbreviation:"b",language:"English",lang:"en",direction:"LTR",sha:"b"},a:{translation:"Alpha",abbreviation:"a",language:"English",lang:"en",direction:"LTR",sha:"a"},c:{translation:"Beta",abbreviation:"c",language:"Afrikaans",lang:"af",direction:"LTR",sha:"c"}});
  assert.deepEqual(list.map(item=>item.abbreviation),["c","a","b"]);
});

test("validates SHA-1 values and weekly freshness",()=>{
  assert.equal(validSha("edeb04d81d465de30775b3cf9d15d08ea441345d"),true);
  assert.equal(validSha("not-a-sha"),false);
  assert.equal(fresh(1_000,1_000+WEEK_MS-1),true);
  assert.equal(fresh(1_000,1_000+WEEK_MS),false);
});

test("identifies passages and whole-verse markings", () => {
  const passage = { translation: "kjv", book: 43, chapter: 3 };
  const marking = {
    id: "one",
    passage,
    verse: 16,
    start: null,
    end: null,
    quote: "For God so loved the world",
    colorId: "yellow",
    createdAt: 1,
  };

  assert.equal(passageKey(passage), "kjv/43/3");
  assert.equal(markingMatchesPassage(marking, passage), true);
  assert.equal(wholeVerseMarking([marking])?.id, "one");
});

test("splits overlapping text markings deterministically", () => {
  const passage = { translation: "kjv", book: 43, chapter: 3 };
  const segments = markedSegments("abcdef", [
    { id: "one", passage, verse: 1, start: 1, end: 4, quote: "bcd", colorId: "yellow", createdAt: 1 },
    { id: "two", passage, verse: 1, start: 3, end: 6, quote: "def", colorId: "blue", createdAt: 2 },
  ]);

  assert.deepEqual(segments.map(({ text, colorId }) => ({ text, colorId })), [
    { text: "a", colorId: null },
    { text: "bc", colorId: "yellow" },
    { text: "d", colorId: "blue" },
    { text: "ef", colorId: "blue" },
  ]);
  assert.equal(translucentColor("#fde68a"), "#fde68a45");
});

test("sorts markings in canonical Bible order", () => {
  const markings = [
    { id: "nt", passage: { translation: "kjv", book: 43, chapter: 3 }, verse: 16, start: null, end: null, quote: "John", colorId: "yellow", createdAt: 1 },
    { id: "ot-later", passage: { translation: "kjv", book: 1, chapter: 2 }, verse: 1, start: null, end: null, quote: "Genesis 2", colorId: "yellow", createdAt: 2 },
    { id: "ot-first", passage: { translation: "kjv", book: 1, chapter: 1 }, verse: 1, start: null, end: null, quote: "Genesis 1", colorId: "yellow", createdAt: 3 },
  ];
  assert.deepEqual(markings.sort(compareMarkings).map((marking) => marking.id), ["ot-first", "ot-later", "nt"]);
});

test("loads marking groups from deployment configuration", () => {
  assert.deepEqual(DEFAULT_MARKING_COLORS.map((color) => color.name), ["Promises", "Growth", "Study", "Prayer"]);
});

test("merges imported colors and markings without duplicates", () => {
  const passage = { translation: "kjv", book: 43, chapter: 3 };
  const existing = { id: "same", passage, verse: 16, start: null, end: null, quote: "For God", colorId: "yellow", createdAt: 1 };
  const collision = { id: "same", passage, verse: 17, start: null, end: null, quote: "For God sent", colorId: "blue", createdAt: 2 };
  const merged = mergeMarkings([existing], [existing, collision]);

  assert.equal(merged.length, 2);
  assert.equal(merged[1].id, "same-imported-1");
  assert.deepEqual(mergeColors([{ id: "yellow", name: "Promises", value: "#fde68a" }], [
    { id: "yellow", name: "Duplicate", value: "#ffffff" },
    { id: "blue", name: "Study", value: "#bfdbfe" },
  ]).map((color) => color.id), ["yellow", "blue"]);
});

test("validates portable markings backups", () => {
  const backup = {
    version: 1 as const,
    exportedAt: "2026-07-15T00:00:00.000Z",
    colors: [{ id: "yellow", name: "Promises", value: "#fde68a" }],
    markings: [{ id: "one", passage: { translation: "kjv", book: 1, chapter: 1 }, verse: 1, start: null, end: null, quote: "In the beginning", colorId: "yellow", createdAt: 1 }],
  };
  assert.deepEqual(parseMarkingsBackup(backup), backup);
  assert.throws(() => parseMarkingsBackup({ version: 2, colors: [], markings: [] }), /unsupported format/);
  assert.throws(() => parseMarkingsBackup({ version: 1, colors: [{ id: "x", name: "Bad", value: "red" }], markings: [] }), /invalid data/);
});

test("requires two separate boundary scroll gestures before changing chapters", () => {
  const first = registerBoundaryScroll(EMPTY_BOUNDARY_SCROLL, 1, true, 1_000);
  assert.equal(first.navigate, false);
  const continuous = registerBoundaryScroll(first.state, 1, true, 1_100);
  assert.equal(continuous.navigate, false);
  const second = registerBoundaryScroll(continuous.state, 1, true, 1_350);
  assert.equal(second.navigate, true);
  assert.deepEqual(second.state, EMPTY_BOUNDARY_SCROLL);
});

test("resets boundary scrolling after leaving the edge, reversing, or waiting", () => {
  const first = registerBoundaryScroll(EMPTY_BOUNDARY_SCROLL, -1, true, 1_000);
  assert.equal(registerBoundaryScroll(first.state, 1, true, 1_300).navigate, false);
  assert.deepEqual(registerBoundaryScroll(first.state, -1, false, 1_300).state, EMPTY_BOUNDARY_SCROLL);
  assert.equal(registerBoundaryScroll(first.state, -1, true, 2_500).navigate, false);
});
