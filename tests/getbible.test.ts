import assert from "node:assert/strict";
import test from "node:test";
import { WEEK_MS, fresh, parsePassage, passageSearch, translationValues, validSha, valuesByNumber } from "../lib/getbible.ts";
import { compareMarkings, markedSegments, markingMatchesPassage, passageKey, translucentColor, wholeVerseMarking } from "../lib/markings.ts";

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
