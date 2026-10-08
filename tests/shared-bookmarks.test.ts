import assert from "node:assert/strict";
import test from "node:test";
import { bookmarkCoordinates, bookmarkReference, bookmarkTopicMatches, bookmarkTopicName, importBookmarkTopic } from "../lib/shared-bookmarks.ts";
import { isSharedBookmarkMarking, mergeColors, mergeMarkings, markingMatchesPassage, parseMarkingsBackup, personalWholeVerseMarking, wholeVerseMarking, withoutWholeVerseMarking, type Marking } from "../lib/markings.ts";

const topic = {
  id: "authority-of-the-bible", name: "Authority of the Bible", color: "#93c5fd",
  aliases: ["Scripture"], names: { en: "Authority of the Bible", af: "Gesag van die Bybel", "zh-hant": "聖經的權威" },
  verses: [[43, 3, 16], [2, 20, 14], [43, 3, 16]] as [number, number, number][],
};

test("shared topics import one stable group and deduplicated whole-verse markings", () => {
  const imported = importBookmarkTopic(topic, "KJV", "af", 123);
  assert.deepEqual(imported.colors, [{ id: "getbible-topic:authority-of-the-bible", name: "Gesag van die Bybel", value: "#93c5fd" }]);
  assert.equal(imported.markings.length, 2);
  assert.equal(imported.markings[0].id, "getbible-topic:authority-of-the-bible:2:20:14");
  assert.deepEqual(imported.markings[0].passage, { translation: "kjv", book: 2, chapter: 20 });
  assert.equal(imported.markings[0].reference, "Exodus 20:14");
  assert.equal(imported.markings[0].quote, "");
  assert.equal(imported.markings[0].start, null);
  assert.equal(imported.markings[0].end, null);
  assert.deepEqual(imported.markings[0].source, { type: "shared-bookmark", topicId: topic.id });
  assert.equal(markingMatchesPassage(imported.markings[0], { translation: "aov", book: 2, chapter: 20 }), true);
});

test("reimport across translation and locale preserves local markings and produces no duplicates", () => {
  const local: Marking = { id: "local-1", passage: { translation: "kjv", book: 43, chapter: 3 }, verse: 16, start: 0, end: 3, quote: "For", colorId: "local-group", createdAt: 100 };
  const localColor = { id: "local-group", name: "My thoughts", value: "#ffcc00" };
  const first = importBookmarkTopic(topic, "kjv", "en", 200);
  const second = importBookmarkTopic(topic, "aov", "af", 300);
  const current = mergeMarkings([local], first.markings);
  const again = mergeMarkings(current, second.markings);
  assert.deepEqual(again, current);
  assert.equal(again[0], local);
  assert.deepEqual(mergeColors(mergeColors([localColor], first.colors), second.colors), [localColor, ...first.colors]);
  assert.equal(second.markings[0].id, first.markings[0].id);
});

test("different public topics may share a verse while retaining distinct groups", () => {
  const first = importBookmarkTopic(topic, "kjv", "en", 100);
  const other = importBookmarkTopic({ ...topic, id: "biblical-love", name: "Biblical Love" }, "kjv", "en", 200);
  assert.equal(mergeColors(first.colors, other.colors).length, 2);
  assert.equal(mergeMarkings(first.markings, other.markings).length, 4);
});

test("shared topic names use exact locale, base language and English fallbacks", () => {
  assert.equal(bookmarkTopicName(topic, "ZH_HANT"), "聖經的權威");
  assert.equal(bookmarkTopicName(topic, "af-NA"), "Gesag van die Bybel");
  assert.equal(bookmarkTopicName(topic, "fr"), "Authority of the Bible");
  assert.equal(bookmarkTopicName({ name: "Original" }, "de"), "Original");
  assert.equal(bookmarkTopicMatches(topic, "Gesag", "af"), true);
  assert.equal(bookmarkTopicMatches(topic, "scripture", "en"), true);
  assert.equal(bookmarkTopicMatches(topic, "AUTHORITY", "af"), true);
  assert.equal(bookmarkTopicMatches(topic, "  ", "af"), true);
  assert.equal(bookmarkTopicMatches(topic, "nonexistent", "en"), false);
});

test("source coordinates reject injections, invalid canon positions, fractions and partial imports", () => {
  const invalid = [null, "43:3:16", [["43", 3, 16]], [[43, 3, 16, 1]], [[0, 1, 1]], [[67, 1, 1]], [[43, 22, 1]], [[1, 1, 0]], [[1, 1, 2001]], [[1, 1, 1.5]], [[1, 1, NaN]], [[1, 1, Infinity]], [[43, 3, "16<script>"]]];
  for (const coordinates of invalid) assert.throws(() => bookmarkCoordinates(coordinates), /invalid Scripture coordinates/);
  assert.throws(() => importBookmarkTopic({ ...topic, verses: [[43, 3, 16], [43, 22, 1]] }, "kjv", "en"), /invalid Scripture coordinates/);
  assert.throws(() => importBookmarkTopic({ ...topic, id: "../bad" }, "kjv", "en"), /invalid metadata/);
  assert.throws(() => importBookmarkTopic({ ...topic, color: "url(evil)" }, "kjv", "en"), /invalid metadata/);
  assert.throws(() => importBookmarkTopic(topic, "../kjv", "en"), /translation/);
  assert.throws(() => importBookmarkTopic(topic, "kjv", "en", Infinity), /timestamp/);
});

test("canonical reference labels cover all shared catalog books and maximum chapters", () => {
  const chapterCounts = [50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22];
  assert.equal(bookmarkReference([1, 50, 1]), "Genesis 50:1");
  assert.equal(bookmarkReference([66, 22, 1]), "Revelation 22:1");
  chapterCounts.forEach((chapters, index) => {
    assert.match(bookmarkReference([index + 1, chapters, 1]), /\S+ \d+:1$/);
    assert.throws(() => bookmarkReference([index + 1, chapters + 1, 1]), /Invalid Scripture coordinates/);
  });
  assert.deepEqual(bookmarkCoordinates([]), []);
});

test("changing or clearing a personal whole-verse highlight retains overlapping shared topic memberships", () => {
  const shared = importBookmarkTopic(topic, "kjv", "en", 200).markings.find((marking) => marking.verse === 16)!;
  const otherShared = importBookmarkTopic({ ...topic, id: "biblical-love" }, "kjv", "en", 300).markings.find((marking) => marking.verse === 16)!;
  const personal: Marking = { id: "personal", passage: { translation: "aov", book: 43, chapter: 3 }, verse: 16, start: null, end: null, quote: "Personal verse", colorId: "yellow", createdAt: 100 };
  const word: Marking = { ...personal, id: "word", start: 0, end: 3, quote: "For" };
  const marks = [personal, shared, word, otherShared];
  assert.equal(wholeVerseMarking(marks), personal);
  assert.equal(personalWholeVerseMarking(marks), personal);
  const cleared = withoutWholeVerseMarking(marks, { translation: "kjv", book: 43, chapter: 3 }, 16);
  assert.deepEqual(cleared, [shared, word, otherShared]);
  assert.equal(personalWholeVerseMarking(cleared), null);
  assert.equal(wholeVerseMarking(cleared), otherShared);
  const recolored = { ...personal, id: "recolored", colorId: "green", createdAt: 400 };
  assert.equal(wholeVerseMarking([...cleared, recolored]), recolored);
  assert.equal(withoutWholeVerseMarking([shared, otherShared], shared.passage, 16).length, 2);
});

test("a personal highlight using a public group's color remains distinct from its source association", () => {
  const shared = importBookmarkTopic(topic, "kjv", "en", 200).markings[0];
  const personal = { ...shared, source: undefined, id: "personal-id", quote: "My highlight" };
  assert.equal(isSharedBookmarkMarking(personal), false);
  const merged = mergeMarkings([personal], [shared]);
  assert.equal(merged.length, 2);
  assert.equal(mergeMarkings(merged, [shared]).length, 2);
  assert.deepEqual(withoutWholeVerseMarking(merged, shared.passage, shared.verse), [shared]);
});

test("portable backups retain shared origin and earlier deterministic imports remain protected", () => {
  const imported = importBookmarkTopic(topic, "kjv", "en", 200);
  const backup = { version: 2 as const, exportedAt: "2026-10-08T00:00:00Z", ...imported };
  assert.deepEqual(parseMarkingsBackup(JSON.parse(JSON.stringify(backup))), backup);
  const legacy = { ...imported.markings[0], source: undefined };
  assert.equal(isSharedBookmarkMarking(legacy), true);
  assert.equal(mergeMarkings([legacy], imported.markings).length, imported.markings.length);
  assert.equal(isSharedBookmarkMarking({ ...legacy, id: "personal-id" }), false);
  const invalidSource = { ...backup, markings: [{ ...imported.markings[0], source: { type: "shared-bookmark", topicId: "../bad" } }] };
  assert.throws(() => parseMarkingsBackup(invalidSource), /invalid data/);
  assert.throws(() => parseMarkingsBackup({ ...backup, markings: [{ ...imported.markings[0], colorId: "unrelated" }] }), /invalid data/);
});

