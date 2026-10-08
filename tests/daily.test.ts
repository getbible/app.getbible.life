import assert from "node:assert/strict";
import test from "node:test";
import { DAILY_SCRIPTURE_CACHE, DAILY_SCRIPTURE_URL, loadDailyReference, parseDailyReference, resolveDailyPassage } from "../lib/daily.ts";
import type { Book, Chapter } from "../lib/getbible.ts";

const now = new Date(2026, 9, 8, 12);
const payload = {
  book: "Revelation", chapter: "1", date: "Thursday 08-October, 2026",
  getbible: "https://getbible.life/kjv/Revelation/1/9", name: "Revelation 1:9",
  scripture: [{ nr: "9", text: "I John, who also am your brother…" }], verse: "9", version: "kjv",
};
const reference = parseDailyReference(payload);
const book: Book = { nr: 66, name: "Revelation of John", direction: "LTR", sha: "" };
const chapter: Chapter = {
  translation: "King James Version", abbreviation: "kjv", language: "English", direction: "LTR",
  book_nr: 66, book_name: book.name, chapter: 1, name: `${book.name} 1`,
  verses: [{ chapter: 1, verse: 9, name: "Revelation 1:9", text: "I John…" }],
};
const response = () => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });

test("resolves the daily feed's book alias using the Query API's canonical v3 identity", async () => {
  const calls: string[] = [];
  const target = await resolveDailyPassage(reference, [book], async (query) => { calls.push(query); return [chapter]; });
  assert.deepEqual(calls, ["Revelation 1:9"]);
  assert.deepEqual(target, { translation: "kjv", book: 66, bookName: "Revelation of John", chapter: 1, verse: 9, verses: [9] });
});

test("retains all daily scripture verses rather than just the linked first verse", () => {
  const selected = parseDailyReference({ ...payload, scripture: [
    { nr: "9", text: "The first verse." }, { nr: "10", text: "The next verse." },
    { nr: "12", text: "A separate verse." }, { nr: "9", text: "A repeated verse." },
  ] });
  assert.equal(selected.verse, 9);
  assert.deepEqual(selected.verses, [9, 10, 12]);
});

test("expands reference ranges and keeps explicit coordinates in the opened chapter", () => {
  const selected = parseDailyReference({ date: payload.date, reference: "John 3:16 – 18, 20; 4:1, 2", verses: ["3:16", "3:22", "4:2"] });
  assert.deepEqual(selected, {
    date: payload.date, translation: "kjv", bookName: "John", chapter: 3, verse: 16,
    verses: [16, 17, 18, 20, 22],
  });
  assert.deepEqual(parseDailyReference({ ...payload, verse: "9-11", name: "Revelation 1:9-11", scripture: [] }).verses, [9, 10, 11]);
});

test("ignores invalid scripture rows and excludes verses from other chapters", () => {
  const selected = parseDailyReference({ ...payload, scripture: [
    null, "unusable", { nr: 10, chapter: 1 }, { nr: 1, chapter: 2 },
    { nr: "1:12" }, { nr: "2:15" }, { nr: "0" }, { nr: "-3" },
  ] });
  assert.deepEqual(selected.verses, [9, 10, 12]);
});

test("resolves a multi-verse alias to the canonical book and retains all selected highlights", async () => {
  const selected = parseDailyReference({ ...payload, scripture: [{ nr: 9 }, { nr: 10 }, { nr: 12 }] });
  const fullChapter = { ...chapter, verses: [9, 10, 12].map((verse) => ({ ...chapter.verses[0], verse })) };
  const calls: string[] = [];
  const target = await resolveDailyPassage(selected, [book], async (query) => { calls.push(query); return [fullChapter]; });
  assert.deepEqual(calls, ["Revelation 1:9-10,12"]);
  assert.deepEqual(target.verses, [9, 10, 12]);
  assert.equal(target.verse, 9);
  assert.equal(target.book, 66);
});

test("compacts long selections into ranges before querying a book alias", async () => {
  const selected = parseDailyReference({ ...payload, verse: "1-176", name: "Revelation 1:1-176", getbible: "", scripture: [] });
  const fullChapter = { ...chapter, verses: selected.verses.map((verse) => ({ ...chapter.verses[0], verse })) };
  const calls: string[] = [];
  await resolveDailyPassage(selected, [book], async (query) => { calls.push(query); return [fullChapter]; });
  assert.deepEqual(calls, ["Revelation 1:1-176"]);
});

test("an incomplete query never silently opens a different or partial daily passage", async () => {
  const selected = parseDailyReference({ ...payload, scripture: [{ nr: 9 }, { nr: 10 }] });
  await assert.rejects(resolveDailyPassage(selected, [book], async () => [chapter]), /unavailable/);
  await assert.rejects(resolveDailyPassage(selected, [book], async () => [{ ...chapter, chapter: 2 }]), /unavailable/);
  await assert.rejects(resolveDailyPassage(selected, [book], async () => []), /unavailable/);
});

test("uses exact case-insensitive book matches without an extra query", async () => {
  const target = await resolveDailyPassage({ ...reference, bookName: "REVELATION OF JOHN" }, [book], async () => { throw new Error("Unexpected query"); });
  assert.equal(target.book, 66);
});

test("never redirects an unresolved daily verse to another passage", async () => {
  await assert.rejects(resolveDailyPassage(reference, [book], async () => [{ ...chapter, verses: [] }]), /unavailable/);
  await assert.rejects(resolveDailyPassage(reference, [book], async () => { throw new Error("Reference not found"); }), /Reference not found/);
});

test("fresh daily cache avoids the network", async () => {
  const storage = { getItem: (key: string) => { assert.equal(key, DAILY_SCRIPTURE_CACHE); return JSON.stringify(payload); }, setItem: () => { throw new Error("Unexpected write"); } };
  assert.deepEqual(await loadDailyReference(now, storage, async () => { throw new Error("Unexpected fetch"); }), reference);
});

test("opening a cached daily passage in the same chapter preserves all verse highlights", async () => {
  const cached = { ...payload, book: book.name, verse: "9-11", scripture: [{ nr: 9 }, { nr: 10 }, { nr: 11 }] };
  const storage = { getItem: () => JSON.stringify(cached), setItem: () => { throw new Error("Unexpected write"); } };
  const fetcher: typeof fetch = async () => { throw new Error("Unexpected network request"); };
  const resolve = async () => resolveDailyPassage(await loadDailyReference(now, storage, fetcher), [book], async () => { throw new Error("Unexpected query"); });
  const first = await resolve();
  const reopened = await resolve();
  assert.deepEqual(first, reopened);
  assert.deepEqual(reopened.verses, [9, 10, 11]);
  assert.equal(reopened.chapter, 1);
});

test("corrupt and stale daily caches are replaced with the current feed", async () => {
  for (const saved of ["{", JSON.stringify({ date: payload.date }), JSON.stringify({ ...payload, date: "Wednesday 07-October, 2026" })]) {
    let written = "";
    const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { written = value; } };
    let calls = 0;
    const fetcher: typeof fetch = async (url, options) => {
      calls++;
      assert.equal(url, DAILY_SCRIPTURE_URL);
      assert.equal(options?.cache, "no-store");
      return response();
    };
    assert.deepEqual(await loadDailyReference(now, storage, fetcher), reference);
    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(written), payload);
  }
});

test("denied daily storage does not discard a successful feed", async () => {
  const storage = { getItem: () => { throw new Error("Storage denied"); }, setItem: () => { throw new Error("Quota exceeded"); } };
  assert.deepEqual(await loadDailyReference(now, storage, async () => response()), reference);
});

test("a failed daily request does not open a stale cached verse", async () => {
  const storage = { getItem: () => JSON.stringify({ ...payload, date: "Wednesday 07-October, 2026" }), setItem: () => {} };
  await assert.rejects(loadDailyReference(now, storage, async () => new Response("Unavailable", { status: 503 })), /HTTP 503/);
});
