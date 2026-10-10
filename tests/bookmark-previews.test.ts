import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { bookmarkPreviewTarget, bookmarkPreviewText, loadBookmarkPreviews, type BookmarkPreview } from "../lib/bookmark-previews.ts";
import type { Chapter } from "../lib/getbible.ts";
import type { Marking } from "../lib/markings.ts";

function marking(overrides: Partial<Marking> = {}): Marking {
  return {
    id: "bookmark", passage: { translation: "kjv", book: 43, chapter: 3 }, verse: 16,
    start: null, end: null, quote: "", colorId: "hope", createdAt: 0, ...overrides,
  };
}

function chapter(translation = "kjv", verse = 16): Chapter {
  return {
    translation, abbreviation: translation, language: "English", direction: "LTR",
    book_nr: 43, book_name: "John", chapter: 3, name: "John 3",
    verses: [{ chapter: 3, verse, name: `John 3:${verse}`, text: `Verse ${verse} text` }],
  };
}

test("whole verse previews use the current translation while selected words retain their original translation", () => {
  assert.deepEqual(bookmarkPreviewTarget(marking(), "AFRIKAANS"), {
    key: "afrikaans/43/3/16", translation: "afrikaans", reference: "43 3:16",
  });
  assert.deepEqual(bookmarkPreviewTarget(marking({ start: 4, end: 7, quote: "God" }), "AFRIKAANS"), {
    key: "kjv/43/3/16", translation: "kjv", reference: "43 3:16",
  });
});

test("preview text preserves exact saved words when the verse has changed and respects UTF16 offsets only without a quote", () => {
  const selection = marking({ start: 4, end: 7, quote: "  God’s love  " });
  assert.equal(bookmarkPreviewText(selection), "  God’s love  ");
  assert.equal(bookmarkPreviewText(selection, "An updated verse shifts the words entirely"), "  God’s love  ");
  assert.equal(bookmarkPreviewText(marking({ start: 3, end: 7 }), "A😀word tail"), "word");
  for (const offsets of [{ start: -1, end: 3 }, { start: 7, end: 3 }, { start: 0, end: 99 }, { start: 0.5, end: 3 }, { start: null, end: 3 }]) {
    assert.equal(bookmarkPreviewText(marking(offsets), "Short text"), "");
  }
});

test("whole verse quote fallback is never presented as a different translation", () => {
  const saved = marking({ quote: "Original English verse" });
  assert.equal(bookmarkPreviewText(saved, undefined, "KJV"), "Original English verse");
  assert.equal(bookmarkPreviewText(saved, undefined, "afrikaans"), "");
  assert.equal(bookmarkPreviewText(saved, "Nuwe teks", "afrikaans"), "Nuwe teks");
});

test("loading deduplicates topic membership and selects the exact matching translation, chapter, and verse", async () => {
  const source = Object.freeze(marking());
  const updates = new Map<string, BookmarkPreview>();
  const calls: string[] = [];
  await loadBookmarkPreviews([source, marking({ id: "another-topic", colorId: "peace" })], "heb", (key, value) => updates.set(key, value), undefined,
    async (translation, reference) => {
      calls.push(`${translation}:${reference}`);
      return [
        chapter("kjv"),
        { ...chapter("heb"), book_nr: 1 },
        { ...chapter("heb"), chapter: 4 },
        { ...chapter("HEB"), direction: "RTL", verses: [chapter("heb", 1).verses[0], { chapter: 3, verse: 16, name: "יוחנן 3:16", text: "פסוק" }] },
      ];
    });
  assert.deepEqual(calls, ["heb:43 3:16"]);
  assert.deepEqual([...updates], [["heb/43/3/16", { text: "פסוק", reference: "יוחנן 3:16", direction: "rtl" }]]);
  assert.equal(source.quote, "");
});

test("word and whole verse bookmarks share a request only when their target translations match", async () => {
  const calls: string[] = [];
  const saved = [marking(), marking({ id: "word", start: 0, end: 5, quote: "Verse" })];
  const query = async (translation: string) => { calls.push(translation); return [chapter(translation)]; };
  await loadBookmarkPreviews(saved, "kjv", () => {}, undefined, query);
  assert.deepEqual(calls, ["kjv"]);
  calls.length = 0;
  await loadBookmarkPreviews(saved, "afrikaans", () => {}, undefined, query);
  assert.deepEqual(calls, ["afrikaans", "kjv"]);
});

test("missing verses and failed requests become row errors without blocking later results", async () => {
  const updates = new Map<string, BookmarkPreview>();
  await loadBookmarkPreviews([16, 17, 18].map(verse => marking({ verse })), "kjv", (key, value) => updates.set(key, value), undefined,
    async (_translation, reference) => {
      if (reference.endsWith(":17")) throw new Error("Network unavailable");
      return [chapter("kjv", 18)];
    });
  assert.deepEqual(updates.get("kjv/43/3/16"), { error: true });
  assert.deepEqual(updates.get("kjv/43/3/17"), { error: true });
  assert.equal(updates.get("kjv/43/3/18")?.text, "Verse 18 text");
});

test("preview requests are limited to four at once and completed rows stream before the topic finishes", async () => {
  const releases: Array<() => void> = [];
  const updates: string[] = [];
  let active = 0, maximum = 0, calls = 0;
  const done = loadBookmarkPreviews(Array.from({ length: 9 }, (_, index) => marking({ verse: index + 1 })), "kjv", key => updates.push(key), undefined,
    async (_translation, reference) => {
      calls += 1;
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>(resolve => releases.push(resolve));
      active -= 1;
      return [chapter("kjv", Number(reference.split(":")[1]))];
    });
  await setImmediate();
  assert.equal(calls, 4);
  releases.shift()!();
  await setImmediate();
  assert.equal(updates.length, 1);
  assert.equal(calls, 5);
  while (releases.length) {
    releases.splice(0).forEach(release => release());
    await setImmediate();
  }
  await done;
  assert.equal(maximum, 4);
  assert.equal(calls, 9);
  assert.equal(updates.length, 9);
});

test("aborting a topic prevents queued requests and late success or error callbacks", async () => {
  const controller = new AbortController();
  const releases: Array<() => void> = [];
  const updates: BookmarkPreview[] = [];
  let calls = 0;
  const done = loadBookmarkPreviews(Array.from({ length: 8 }, (_, index) => marking({ verse: index + 1 })), "kjv", (_key, value) => updates.push(value), controller.signal,
    async (_translation, reference, signal) => {
      calls += 1;
      assert.equal(signal, controller.signal);
      await new Promise<void>(resolve => releases.push(resolve));
      if (reference.endsWith(":1")) throw new Error("A delayed failure");
      return [chapter("kjv", Number(reference.split(":")[1]))];
    });
  await setImmediate();
  controller.abort();
  releases.forEach(release => release());
  await done;
  assert.equal(calls, 4);
  assert.deepEqual(updates, []);
  await loadBookmarkPreviews([marking()], "kjv", () => assert.fail("Already aborted callback"), controller.signal, async () => {
    assert.fail("Already aborted request");
  });
});
