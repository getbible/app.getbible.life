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
  assert.deepEqual(target, { translation: "kjv", book: 66, bookName: "Revelation of John", chapter: 1, verse: 9 });
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
