import assert from "node:assert/strict";
import test from "node:test";
import { WEEK_MS, fresh, parsePassage, passageSearch, translationValues, validSha, valuesByNumber } from "../lib/getbible.ts";

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
