import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import {
  COMMENTARIES_ROOT, DICTIONARIES_ROOT, STUDY_CACHE_NAME,
  commentsForVerse, defaultDictionary, dictionarySuggestions, downloadBookmarkCatalog, downloadDictionary,
  findDictionaryMatches, getBookmarkLocale, getBookmarkTopic, getBookmarkTopics, getCommentaryChapter,
  getDictionaryEntry, getDictionaryIndex, isStudyDownloaded, normalizeStudyTerm, removeStudyDownload,
  scriptureReferenceQuery, studyTextSegments,
  type BookmarkAll, type CommentaryEntry, type DictionaryIndex, type DictionarySummary,
} from "../lib/study-api.ts";

const dictionaries: DictionarySummary[] = [
  { id: "easton", name: "Easton", language: "en", license: "Public Domain", strong_prefix: null, entry_count: 2, unique_key_count: 1, bytes: 10 },
  { id: "strongsgreek", name: "Strong Greek", language: "en", license: "Public Domain", strong_prefix: "G", entry_count: 1, unique_key_count: 1, bytes: 10 },
  { id: "strongshebrew", name: "Strong Hebrew", language: "en", license: "Public Domain", strong_prefix: "H", entry_count: 1, unique_key_count: 1, bytes: 10 },
  { id: "swedish", name: "Swedish", language: "sv", license: "Public Domain", strong_prefix: null, entry_count: 1, unique_key_count: 1, bytes: 10 },
];
test("dictionary defaults respect original-language tokens and definition language", () => {
  assert.equal(defaultDictionary(dictionaries, "en"), "easton");
  assert.equal(defaultDictionary(dictionaries, "sv"), "swedish");
  assert.equal(defaultDictionary(dictionaries, "sv", ["G3056"]), "strongsgreek");
  assert.equal(defaultDictionary(dictionaries, "en", ["H0430"], "strongsgreek"), "strongshebrew");
  assert.equal(defaultDictionary(dictionaries, "en", [], "strongshebrew"), "strongshebrew");
});
test("dictionary lookup follows exact entry IDs and keeps repeated definitions", () => {
  const index: DictionaryIndex = { schema: "index", dictionary: "easton", language: "en", entries: [
    { id: "k-KADESH", key: "KADESH", search: "kadesh" },
    { id: "k-KADESH--2", key: "KADESH", search: "kadesh", occurrence: 2 },
    { id: "G3056", key: "03056", search: "03056", aliases: ["G3056", "03056"] },
    { id: "k-LOVE", key: "LOVE", search: "love" },
  ] };
  assert.deepEqual(findDictionaryMatches(index, "Kadesh,").map((entry) => entry.id), ["k-KADESH", "k-KADESH--2"]);
  assert.deepEqual(findDictionaryMatches(index, "the word", ["G3056"]).map((entry) => entry.id), ["G3056"]);
  assert.deepEqual(dictionarySuggestions(index, "lov").map((entry) => entry.id), ["k-LOVE"]);
  assert.equal(normalizeStudyTerm("ÉPHÈSE."), "ephese");
});
test("commentary verse lookup includes shared coverage and preserves introductions", () => {
  const entries: CommentaryEntry[] = [
    { book: 43, chapter: 1, verse: 0, text: "Introduction" },
    { book: 43, chapter: 1, verse: 1, verses: [1, 2, 3], text: "Shared comment" },
    { book: 43, chapter: 1, verse: 4, text: "Separate comment" },
  ];
  assert.deepEqual(commentsForVerse(entries, 3).map((entry) => entry.text), ["Introduction", "Shared comment"]);
  assert.equal(commentsForVerse(entries).length, 3);
});
test("study citation links preserve every text character and prefer full references", () => {
  const text = "<b>Read John 1:1-3, then John 1:1. 😀 John 1:1-3.</b>";
  const parts = studyTextSegments(text, [
    { text: "John 1:1", ref: "John 1:1", osis: "John.1.1", book: 43, chapter: 1, verse: 1 },
    { text: "John 1:1-3", ref: "John 1:1-3", osis: "John.1.1", book: 43, chapter: 1, verse: 1, verses: [1, 2, 3] },
  ]);
  assert.equal(parts.map((part) => part.text).join(""), text);
  assert.deepEqual(parts.filter((part) => part.reference).map((part) => part.text), ["John 1:1-3", "John 1:1", "John 1:1-3"]);
  assert.equal(scriptureReferenceQuery({ ref: "Jean 1:1-3,6", osis: "John.1.1", book: 43, chapter: 1, verses: [6, 1, 2, 3, 2] }), "43 1:1-3,6");
  assert.equal(scriptureReferenceQuery({ ref: "John 1", osis: "John.1", book: 43, chapter: 1 }), "43 1");
  const prefixes = studyTextSegments("John 1:10; John 1:1-5; John 1:1.", [{ text: "John 1:1", ref: "John 1:1", osis: "John.1.1", book: 43, chapter: 1, verse: 1 }]);
  assert.deepEqual(prefixes.filter((part) => part.reference).map((part) => part.text), ["John 1:1"]);
});

function mockCache() {
  const values = new Map<string, Response>();
  const cache = {
    match: async (input: RequestInfo | URL) => values.get(String(input))?.clone(),
    put: async (input: RequestInfo | URL, response: Response) => { values.set(String(input), response.clone()); },
    delete: async (input: RequestInfo | URL) => values.delete(String(input)),
  } as unknown as Cache;
  const storage = { open: async (name: string) => { assert.equal(name, STUDY_CACHE_NAME); return cache; } } as unknown as CacheStorage;
  return { values, storage };
}
async function withNetwork(cache: CacheStorage, fetcher: typeof fetch, action: () => Promise<void>) {
  const originalFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "caches", { value: cache, configurable: true });
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  globalThis.fetch = fetcher;
  try { await action(); } finally {
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, "caches", descriptor); else Reflect.deleteProperty(globalThis, "caches");
    if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor); else Reflect.deleteProperty(globalThis, "crypto");
  }
}
test("cached complete study modules supply entries and chapters without network requests", async () => {
  const { values, storage } = mockCache();
  values.set(`${DICTIONARIES_ROOT}/offline-dictionary.json`, new Response(JSON.stringify({ schema: "dictionary", dictionary: "offline-dictionary", language: "en", name: "Offline", entries: [
    { schema: "entry", dictionary: "offline-dictionary", language: "en", id: "H0430", key: "00430", occurrence: 1, aliases: ["H0430"], text: "God" },
  ] })));
  values.set(`${COMMENTARIES_ROOT}/offline-commentary.json`, new Response(JSON.stringify({ schema: "commentary", commentary: "offline-commentary", name: "Offline", language: "en", books: [
    { book: 43, chapters: [{ schema: "chapter", commentary: "offline-commentary", language: "en", book: 43, name: "John", chapter: 1, entries: [{ book: 43, chapter: 1, verse: 1, text: "Comment" }] }] },
  ] })));
  await withNetwork(storage, async () => { throw new Error("No network should be needed"); }, async () => {
    assert.equal((await getDictionaryEntry("offline-dictionary", "H0430")).text, "God");
    assert.equal((await getDictionaryIndex("offline-dictionary")).entries[0].id, "H0430");
    assert.equal((await getCommentaryChapter("offline-commentary", 43, 1)).entries[0].text, "Comment");
    assert.equal(await isStudyDownloaded("dictionary", "offline-dictionary"), true);
    await removeStudyDownload("dictionary", "offline-dictionary");
    assert.equal(await isStudyDownloaded("dictionary", "offline-dictionary"), false);
  });
});
test("bulk bookmark download verifies exact bytes and supports offline topics and locale names", async () => {
  const { storage } = mockCache();
  const all: BookmarkAll = { schema_version: 1, topics: [{ id: "study-test", name: "Study", color: "#aabbcc", aliases: [], default: false, verses: [[43, 3, 16]] }], locales: { af: { schema_version: 1, locale: "af", topics: { "study-test": "Studie" } } } };
  const bytes = JSON.stringify(all);
  const digest = Array.from(new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(bytes))), (byte) => byte.toString(16).padStart(2, "0")).join("");
  await withNetwork(storage, async (input) => String(input).endsWith("checksums.json") ? new Response(JSON.stringify({ files: { "all.json": digest } })) : new Response(bytes), async () => {
    await downloadBookmarkCatalog();
    globalThis.fetch = async () => { throw new Error("Offline"); };
    assert.equal((await getBookmarkTopics()).topics[0].verses, 1);
    assert.equal((await getBookmarkTopic("study-test")).names.af, "Studie");
    assert.equal((await getBookmarkLocale("AF")).topics["study-test"], "Studie");
  });
});
test("an inconsistent bulk download is retried and never marked available offline", async () => {
  const { storage } = mockCache();
  let requests = 0;
  await withNetwork(storage, async (input) => {
    requests += 1;
    return String(input).endsWith("hashes.json") ? new Response(JSON.stringify({ files: { "bad-download.json": "0".repeat(64) } })) : new Response("{}");
  }, async () => {
    await assert.rejects(downloadDictionary("bad-download"), /changed during download/);
    assert.equal(requests, 4);
    assert.equal(await isStudyDownloaded("dictionary", "bad-download"), false);
  });
});
test("aborted resource requests never return a stale cache document", async () => {
  const { values, storage } = mockCache();
  values.set(`${DICTIONARIES_ROOT}/aborted-dictionary/index.json`, new Response(JSON.stringify({ entries: [] })));
  const controller = new AbortController(); controller.abort();
  await withNetwork(storage, async () => { throw new Error("Offline"); }, async () => {
    await assert.rejects(getDictionaryIndex("aborted-dictionary", controller.signal), { name: "AbortError" });
  });
});
