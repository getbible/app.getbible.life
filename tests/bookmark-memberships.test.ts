import assert from "node:assert/strict";
import test from "node:test";
import { addBookmarkMembership, bookmarkAssignments, isSharedBookmarkMarking, removeBookmarkMembership, wholeVerseMarking, type Marking } from "../lib/markings.ts";

const passage = { translation: "kjv", book: 43, chapter: 3 };
const personal: Marking = {
  id: "personal-prayer", colorId: "prayer", passage, verse: 16,
  start: null, end: null, quote: "For God so loved the world", reference: "John 3:16", createdAt: 10,
};
const global: Marking = {
  ...personal, id: "global-prayer", quote: "", createdAt: 20,
  source: { type: "shared-bookmark", topicId: "prayer" },
};

test("a verse can receive multiple personal topics without replacing its downloaded memberships", () => {
  const grace = { ...personal, id: "personal-grace", colorId: "grace", createdAt: 30 };
  const marked = addBookmarkMembership(addBookmarkMembership([global], personal), grace);
  assert.deepEqual(marked, [global, personal, grace]);
  const assignments = bookmarkAssignments(marked, passage, 16);
  assert.deepEqual(assignments.map((assignment) => [assignment.colorId, assignment.personal.map((marking) => marking.id), assignment.global.map((marking) => marking.id)]), [
    ["prayer", [personal.id], [global.id]],
    ["grace", [grace.id], []],
  ]);
  assert.equal(wholeVerseMarking(marked), grace);
});

test("repeat additions preserve original IDs, quotes, timestamps and separate personal/global provenance", () => {
  const marked = [personal, global];
  const anotherTranslation = { ...passage, translation: "aov" };
  assert.equal(addBookmarkMembership(marked, { ...personal, id: "new-personal", passage: anotherTranslation, quote: "A new quote", createdAt: 100 }), marked);
  assert.equal(addBookmarkMembership(marked, { ...global, id: "new-global", passage: anotherTranslation, createdAt: 200 }), marked);
  assert.equal(bookmarkAssignments(marked, anotherTranslation, 16)[0].personal[0], personal);
  assert.equal(bookmarkAssignments(marked, anotherTranslation, 16)[0].global[0], global);
  assert.equal(isSharedBookmarkMarking(marked[0]), false);
  assert.equal(isSharedBookmarkMarking(marked[1]), true);
});

test("removing a personal assignment keeps its global origin, other topics, ranges and verses", () => {
  const grace = { ...personal, id: "grace", colorId: "grace" };
  const word = { ...personal, id: "word", start: 0, end: 3, quote: "For" };
  const otherVerse = { ...personal, id: "other-verse", verse: 17 };
  const marked = [personal, global, grace, word, otherVerse];
  const removed = removeBookmarkMembership(marked, { ...passage, translation: "aov" }, 16, "prayer");
  assert.deepEqual(removed, [global, grace, word, otherVerse]);
  assert.deepEqual(removeBookmarkMembership(marked, passage, 16, "prayer", null, null, "global"), [personal, grace, word, otherVerse]);
  assert.deepEqual(removeBookmarkMembership(marked, passage, 16, "prayer", null, null, "all"), [grace, word, otherVerse]);
  assert.deepEqual(marked, [personal, global, grace, word, otherVerse]);
});

test("exact selected ranges can belong to several topics and remain translation scoped", () => {
  const word = { ...personal, id: "word-prayer", start: 0, end: 3, quote: "For" };
  const wordGrace = { ...word, id: "word-grace", colorId: "grace" };
  const overlap = { ...word, id: "overlap", start: 0, end: 7, quote: "For God" };
  const translated = { ...word, id: "translated", passage: { ...passage, translation: "aov" }, quote: "Want" };
  const marked = addBookmarkMembership(addBookmarkMembership([personal, global, overlap, translated], word), wordGrace);
  assert.equal(addBookmarkMembership(marked, { ...word, id: "duplicate", quote: "Different quote" }), marked);
  assert.deepEqual(bookmarkAssignments(marked, passage, 16, 0, 3).map((assignment) => [assignment.colorId, assignment.personal.map((marking) => marking.id)]), [["prayer", [word.id]], ["grace", [wordGrace.id]]]);
  assert.deepEqual(bookmarkAssignments(marked, translated.passage, 16, 0, 3)[0].personal, [translated]);
  assert.deepEqual(removeBookmarkMembership(marked, passage, 16, "prayer", 0, 3), [personal, global, overlap, translated, wordGrace]);
});

test("membership lookups and removal never confuse chapters or whole verses with word selections", () => {
  const word = { ...personal, id: "word", start: 0, end: 3, quote: "For" };
  const otherChapter = { ...personal, id: "other-chapter", passage: { ...passage, chapter: 4 } };
  const otherBook = { ...personal, id: "other-book", passage: { ...passage, book: 44 } };
  const marked = [word, otherChapter, otherBook];
  assert.deepEqual(bookmarkAssignments(marked, passage, 16), []);
  assert.deepEqual(bookmarkAssignments(marked, passage, 16, 0, 3)[0].personal, [word]);
  assert.deepEqual(removeBookmarkMembership(marked, passage, 16, "prayer", null, null, "all"), marked);
});
