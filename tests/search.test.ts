import assert from "node:assert/strict";
import test from "node:test";
import { highlightSearchText } from "../lib/search.ts";

const options = { match: "exact", caseSensitive: false, locale: "en" } as const;

test("accent folding matches accented words while keeping their original Scripture spelling", () => {
  const text = "Jésus answered: Jesus.";
  const result = highlightSearchText(text, "Jesus", { ...options, diacritics: "fold" });
  assert.deepEqual(result.filter(segment => segment.highlighted).map(segment => segment.text), ["Jésus", "Jesus"]);
  assert.equal(result.map(segment => segment.text).join(""), text);
  assert.deepEqual(highlightSearchText(text, "Jesus", options).filter(segment => segment.highlighted).map(segment => segment.text), ["Jesus"]);
  assert.deepEqual(highlightSearchText(text, "Jesus", { ...options, diacritics: "exact" }).filter(segment => segment.highlighted).map(segment => segment.text), ["Jesus"]);
});

test("decomposed marks remain inside the original highlighted span without moving following offsets", () => {
  const text = "✦ Je\u0301sus, JÉSUS; rejoices.";
  const result = highlightSearchText(text, "Jesus", { ...options, diacritics: "fold" });
  assert.deepEqual(result.filter(segment => segment.highlighted).map(segment => segment.text), ["Je\u0301sus", "JÉSUS"]);
  assert.equal(result.map(segment => segment.text).join(""), text);
  let offset = 0;
  for (const segment of result) {
    assert.equal(text.slice(offset, offset + segment.text.length), segment.text);
    offset += segment.text.length;
  }
  assert.equal(offset, text.length);
  const canonical = highlightSearchText("Je\u0301sus", "Jésus", { ...options, diacritics: "exact" });
  assert.deepEqual(canonical, [{ text: "Je\u0301sus", highlighted: true }]);
});

test("case and whole-word restrictions remain effective when folding accents", () => {
  const text = "Jésus jésus Jésuslike";
  const exact = highlightSearchText(text, "Jesus", { ...options, caseSensitive: true, diacritics: "fold" });
  assert.deepEqual(exact.filter(segment => segment.highlighted).map(segment => segment.text), ["Jésus"]);
  const partial = highlightSearchText(text, "Jesus", { ...options, match: "partial", diacritics: "fold" });
  assert.deepEqual(partial.filter(segment => segment.highlighted).map(segment => segment.text), ["Jésus", "jésus", "Jésuslike"]);
});

test("fallback segmentation preserves original combining marks and respects whole-word matching", (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter")!;
  Object.defineProperty(Intl, "Segmenter", { value: undefined, configurable: true });
  t.after(() => Object.defineProperty(Intl, "Segmenter", descriptor));
  const text = "Je\u0301sus, Jésuslike; Jésus.";
  const result = highlightSearchText(text, "Jesus", { ...options, diacritics: "fold" });
  assert.deepEqual(result.filter(segment => segment.highlighted).map(segment => segment.text), ["Je\u0301sus", "Jésus"]);
  assert.equal(result.map(segment => segment.text).join(""), text);
});
