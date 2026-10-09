import assert from "node:assert/strict";
import test from "node:test";
import {
  isReadableScriptureReference, scriptureReferenceQuery, scriptureReferencesQuery, studyTextSegments,
  type ScriptureReference,
} from "../lib/study-api.ts";

const reference = (book: number, chapter: number, verse: number, text: string): ScriptureReference => ({
  book, chapter, verse, text, ref: `${book} ${chapter}:${verse}`, osis: "",
});

test("a commentary citation group opens every published passage in source order", () => {
  const firstLine = "10:27; Ex 24:17; Nu 11:1; 16:35; De 4:24; 9:3; Ps 50:3; 97:3";
  const secondLine = "Isa 66:15; Da 7:9; 2Th 1:8";
  const references = [
    reference(58, 10, 27, firstLine), reference(2, 24, 17, firstLine),
    reference(4, 11, 1, firstLine), reference(4, 16, 35, firstLine),
    reference(5, 4, 24, firstLine), reference(5, 9, 3, firstLine),
    reference(19, 50, 3, firstLine), reference(19, 97, 3, firstLine),
    reference(23, 66, 15, secondLine), reference(27, 7, 9, secondLine), reference(53, 1, 8, secondLine),
  ];
  const text = `${firstLine}\n${secondLine}`;
  const segments = studyTextSegments(text, references);
  assert.equal(segments.map((segment) => segment.text).join(""), text);
  const links = segments.filter((segment) => segment.references);
  assert.equal(links.length, 2);
  assert.equal(scriptureReferencesQuery(links[0].references!), "58 10:27;2 24:17;4 11:1;4 16:35;5 4:24;5 9:3;19 50:3;19 97:3");
  assert.equal(scriptureReferencesQuery(links[1].references!), "23 66:15;27 7:9;53 1:8");
});

test("grouped links preserve chapter ranges and nonconsecutive verses without duplicate requests", () => {
  const label = "John 1:1-3,6; 2";
  const first: ScriptureReference = { ...reference(43, 1, 1, label), verses: [6, 1, 2, 3, 2] };
  const second: ScriptureReference = { book: 43, chapter: 2, text: label, ref: "John 2", osis: "John.2" };
  const segments = studyTextSegments(`${label}. Again: ${label}.`, [first, second, { ...first }]);
  const links = segments.filter((segment) => segment.references);
  assert.equal(links.length, 2);
  for (const link of links) assert.equal(scriptureReferencesQuery(link.references!), "43 1:1-3,6;43 2");
});

test("invalid source coordinates remain plain text and cannot enter a grouped query", () => {
  const valid = reference(43, 3, 16, "John 3:16");
  const invalid = [
    { ...valid, book: 0 }, { ...valid, book: 84 }, { ...valid, chapter: 0 },
    { ...valid, chapter: 1.5 }, { ...valid, verse: -1 }, { ...valid, verses: [1, NaN] },
  ];
  for (const item of invalid) {
    assert.equal(isReadableScriptureReference(item), false);
    assert.throws(() => scriptureReferenceQuery(item), /Invalid scripture reference/);
  }
  assert.deepEqual(studyTextSegments("John 3:16", invalid), [{ text: "John 3:16" }]);
  assert.equal(scriptureReferencesQuery([...invalid, valid]), "43 3:16");
});
