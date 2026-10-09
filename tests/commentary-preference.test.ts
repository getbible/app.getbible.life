import assert from "node:assert/strict";
import test from "node:test";
import { defaultCommentary } from "../lib/commentary-preference.ts";
import type { CommentarySummary } from "../lib/study-api.ts";

const commentary = (id: string, language = "en", entry_count = 1): CommentarySummary => ({
  id, name: id, language, entry_count, license: "Public Domain", book_count: 1, chapter_count: 1, bytes: 10,
});
const catalog = [commentary("mhcc"), commentary("localized", "af"), commentary("tsk")];

test("commentary opens TSK by default regardless of catalog order or Bible language", () => {
  assert.equal(defaultCommentary(catalog, "en"), "tsk");
  assert.equal(defaultCommentary(catalog, "af"), "tsk");
  assert.equal(defaultCommentary([...catalog].reverse(), "en"), "tsk");
});

test("an available remembered commentary overrides the default", () => {
  assert.equal(defaultCommentary(catalog, "en", "mhcc"), "mhcc");
  assert.equal(defaultCommentary(catalog, "af", "localized"), "localized");
  assert.equal(defaultCommentary(catalog, "af", "mhcc"), "mhcc");
});

test("removed or empty remembered resources fall back to TSK", () => {
  assert.equal(defaultCommentary(catalog, "en", "removed"), "tsk");
  assert.equal(defaultCommentary([...catalog, commentary("empty", "en", 0)], "en", "empty"), "tsk");
});

test("missing TSK falls back to readable resources, preferring the Bible language", () => {
  const available = [commentary("other", "de"), commentary("english"), commentary("localized", "af"), commentary("tsk", "en", 0)];
  assert.equal(defaultCommentary(available, "AF"), "localized");
  assert.equal(defaultCommentary(available, "fr"), "english");
  assert.equal(defaultCommentary([available[0]], "en"), "other");
  assert.equal(defaultCommentary([commentary("empty", "en", 0)], "en"), "");
  assert.equal(defaultCommentary([], "en", "tsk"), "");
});
