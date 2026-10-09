import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { CACHE_MAX_AGE_MS } from "../lib/cache-policy.ts";
import { clearDictionaryLookup, lookupDictionaries } from "../lib/dictionary-lookup.ts";
import {
  COMMENTARIES_ROOT, DICTIONARIES_ROOT, STUDY_CACHE_NAME,
  clearStudyCache, downloadAllStudyResources, getCommentaryChapter, getDictionaryEntry,
  getDictionaryIndex, listStudyCache, removeStudyDownload,
  type DictionaryCatalog, type StudyDownloadProgress,
} from "../lib/study-api.ts";

const at = "x-getbible-cached-at", size = "x-getbible-cache-bytes";
function document(value: unknown, savedAt = Date.now()) {
  const text = JSON.stringify(value);
  return new Response(text, { headers: { [at]: String(savedAt), [size]: String(new TextEncoder().encode(text).byteLength) } });
}
function storage() {
  const values = new Map<string, Response>();
  const key = (input: RequestInfo | URL) => input instanceof Request ? input.url : String(input);
  const cache = {
    match: async (input: RequestInfo | URL) => values.get(key(input))?.clone(),
    put: async (input: RequestInfo | URL, response: Response) => { values.set(key(input), response.clone()); },
    delete: async (input: RequestInfo | URL) => values.delete(key(input)),
    keys: async () => [...values.keys()].map((url) => new Request(url)),
  } as unknown as Cache;
  return { values, cache: {
    open: async (name: string) => { assert.equal(name, STUDY_CACHE_NAME); return cache; },
    delete: async () => { values.clear(); return true; },
  } as unknown as CacheStorage };
}
async function fixture(fetcher: typeof fetch, action: (values: Map<string, Response>) => Promise<void>) {
  const { values, cache } = storage();
  const originalFetch = globalThis.fetch;
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", { value: cache, configurable: true });
  globalThis.fetch = fetcher;
  try { await clearStudyCache(); await action(values); }
  finally {
    await clearStudyCache();
    globalThis.fetch = originalFetch;
    if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches); else Reflect.deleteProperty(globalThis, "caches");
  }
}
async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.ok(predicate(), "background operation completed");
}

test("persistent study fragments are read before the network and new reads store timestamps", async () => {
  let requests = 0;
  await fixture(async () => { requests += 1; return document({ entries: [], name: "New" }); }, async (values) => {
    values.set(`${DICTIONARIES_ROOT}/fresh/index.json`, document({ entries: [{ id: "G1" }] }));
    values.set(`${DICTIONARIES_ROOT}/fresh/G1.json`, document({ text: "Cached definition" }));
    values.set(`${COMMENTARIES_ROOT}/fresh/43/1.json`, document({ entries: [{ text: "Cached commentary" }] }));
    assert.equal((await getDictionaryIndex("fresh")).entries[0].id, "G1");
    assert.equal((await getDictionaryEntry("fresh", "G1")).text, "Cached definition");
    assert.equal((await getCommentaryChapter("fresh", 43, 1)).entries[0].text, "Cached commentary");
    assert.equal(requests, 0);
    await getCommentaryChapter("fresh", 43, 2);
    assert.equal(requests, 1);
    assert.ok(Number(values.get(`${COMMENTARIES_ROOT}/fresh/43/2.json`)?.headers.get(at)) > 0);
    await getCommentaryChapter("fresh", 43, 2);
    assert.equal(requests, 1);
  });
});

test("expired fragments remain immediately readable while one background refresh replaces them", async () => {
  let resolve!: (response: Response) => void;
  let requests = 0;
  await fixture(async () => { requests += 1; return new Promise<Response>((accept) => { resolve = accept; }); }, async (values) => {
    const url = `${DICTIONARIES_ROOT}/expired/G1.json`;
    values.set(url, document({ text: "Old" }, Date.now() - CACHE_MAX_AGE_MS - 1));
    assert.equal((await getDictionaryEntry("expired", "G1")).text, "Old");
    assert.equal((await getDictionaryEntry("expired", "G1")).text, "Old");
    assert.equal(requests, 1);
    resolve(document({ text: "Fresh" }));
    await eventually(() => Number(values.get(url)?.headers.get(at)) > Date.now() - CACHE_MAX_AGE_MS);
    assert.equal((await getDictionaryEntry("expired", "G1")).text, "Fresh");
    assert.equal(requests, 1);
  });
});

test("failed refreshes preserve stale documents and expiration refreshes have bounded concurrency", async () => {
  const pending: (() => void)[] = [];
  let active = 0, peak = 0, completed = 0;
  await fixture(async () => {
    active += 1; peak = Math.max(peak, active);
    await new Promise<void>((resolve) => pending.push(resolve));
    active -= 1; completed += 1;
    throw new TypeError("Offline");
  }, async (values) => {
    for (let index = 0; index < 7; index += 1) values.set(`${DICTIONARIES_ROOT}/bounded/G${index}.json`, document({ text: `Saved ${index}` }, 1));
    for (let index = 0; index < 7; index += 1) assert.equal((await getDictionaryEntry("bounded", `G${index}`)).text, `Saved ${index}`);
    assert.equal(peak, 3);
    while (completed < 7) {
      await eventually(() => pending.length > 0);
      pending.splice(0).forEach((resolve) => resolve());
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(peak, 3);
    assert.equal(values.size, 7);
    assert.equal(await values.get(`${DICTIONARIES_ROOT}/bounded/G0.json`)?.clone().json().then((value) => value.text), "Saved 0");
  });
});

test("resource removal clears full modules and fragments without clearing another resource", async () => {
  await fixture(async () => { throw new TypeError("Offline"); }, async (values) => {
    values.set(`${DICTIONARIES_ROOT}/remove.json`, document({ dictionary: "remove", entries: [] }));
    values.set(`${DICTIONARIES_ROOT}/remove/index.json`, document({ entries: [] }));
    values.set(`${DICTIONARIES_ROOT}/remove/G1.json`, document({ text: "Remove" }));
    values.set(`${DICTIONARIES_ROOT}/keep/index.json`, document({ entries: [] }));
    values.set(`${COMMENTARIES_ROOT}/keep/43/1.json`, document({ entries: [] }));
    const statuses = await listStudyCache();
    assert.equal(statuses.find((item) => item.id === "remove")?.downloaded, true);
    assert.equal(statuses.find((item) => item.id === "remove")?.documents, 3);
    assert.ok((statuses.find((item) => item.id === "remove")?.bytes ?? 0) > 0);
    await getDictionaryEntry("remove", "G1");
    await removeStudyDownload("dictionary", "remove");
    assert.equal(values.size, 2);
    await assert.rejects(getDictionaryEntry("remove", "G1"), /Offline/);
    await clearStudyCache("dictionary");
    assert.deepEqual([...values.keys()], [`${COMMENTARIES_ROOT}/keep/43/1.json`]);
  });
});

test("removing a resource cancels its stale refresh and prevents a late response from restoring it", async () => {
  let resolve!: (response: Response) => void;
  await fixture(async () => new Promise<Response>((accept) => { resolve = accept; }), async (values) => {
    const url = `${DICTIONARIES_ROOT}/removed/G1.json`;
    values.set(url, document({ text: "Old" }, 1));
    await getDictionaryEntry("removed", "G1");
    await removeStudyDownload("dictionary", "removed");
    resolve(document({ text: "Late" }));
    await new Promise((accept) => setTimeout(accept, 10));
    assert.equal(values.has(url), false);
  });
});

test("expired complete modules refresh through checksum verification while saved entries stay available", async () => {
  const entry = (text: string) => ({ dictionary: "module", id: "G1", key: "word", aliases: [], text });
  const bytes = JSON.stringify({ dictionary: "module", entries: [entry("Updated")] });
  const hash = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(bytes))).toString("hex");
  let resolve!: () => void;
  const barrier = new Promise<void>((accept) => { resolve = accept; });
  const calls: string[] = [];
  await fixture(async (input) => {
    calls.push(String(input));
    await barrier;
    return String(input).endsWith("hashes.json") ? document({ files: { "module.json": hash } }) : new Response(bytes);
  }, async (values) => {
    const url = `${DICTIONARIES_ROOT}/module.json`;
    values.set(url, document({ dictionary: "module", entries: [entry("Saved")] }, 1));
    assert.equal((await getDictionaryEntry("module", "G1")).text, "Saved");
    resolve();
    await eventually(() => Number(values.get(url)?.headers.get(at)) > 1);
    assert.equal((await getDictionaryEntry("module", "G1")).text, "Updated");
    assert.deepEqual(calls.sort(), [`${DICTIONARIES_ROOT}/hashes.json`, url].sort());
    assert.equal(values.get(url)?.headers.get("x-getbible-sha256"), hash);
  });
});

test("derived dictionary lookups expire after thirty days even when the catalog publication is unchanged", async () => {
  const resources: DictionaryCatalog = { schema: "catalog", generated_at: "same-publication", dictionaries: [{
    id: "long-session", name: "Long session", language: "en", license: "Public domain", strong_prefix: null,
    entry_count: 1, unique_key_count: 1, bytes: 100,
  }] };
  const originalNow = Date.now;
  let now = originalNow(), generation = 1;
  Date.now = () => now;
  try {
    await fixture(async (input) => String(input).endsWith("index.json") ? document({ entries: [{ id: "word", key: "word", search: "word" }] }) : document({
      dictionary: "long-session", id: "word", text: `Generation ${generation}`,
    }), async (values) => {
      clearDictionaryLookup();
      assert.equal((await lookupDictionaries(resources, "word")).matches[0].entries[0].text, "Generation 1");
      now += CACHE_MAX_AGE_MS + 1; generation = 2;
      assert.equal((await lookupDictionaries(resources, "word")).matches[0].entries[0].text, "Generation 1", "expired content remains immediately available");
      await eventually(() => Number(values.get(`${DICTIONARIES_ROOT}/long-session/word.json`)?.headers.get(at)) === now);
      assert.equal((await lookupDictionaries(resources, "word")).matches[0].entries[0].text, "Generation 2");
    });
  } finally { Date.now = originalNow; clearDictionaryLookup(); }
});

test("bulk downloads verify complete modules sequentially, skip fresh copies, and stop on cancellation", async () => {
  const resources = ["first", "second", "third"].map((id) => ({ id, name: id, entry_count: 1, bytes: 50 }));
  const modules = Object.fromEntries(resources.map(({ id }) => [`${id}.json`, JSON.stringify({ dictionary: id, entries: [] })]));
  const files = Object.fromEntries(await Promise.all(Object.entries(modules).map(async ([path, text]) => [path,
    Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString("hex"),
  ])));
  const calls: string[] = [];
  await fixture(async (input) => {
    const path = String(input).slice(DICTIONARIES_ROOT.length + 1); calls.push(path);
    if (path === "hashes.json") return document({ files });
    return new Response(modules[path]);
  }, async (values) => {
    values.set(`${DICTIONARIES_ROOT}/dictionaries.json`, document({ dictionaries: resources }));
    values.set(`${DICTIONARIES_ROOT}/first.json`, document({ dictionary: "first", entries: [] }));
    const updates: StudyDownloadProgress[] = [];
    const controller = new AbortController();
    await assert.rejects(downloadAllStudyResources("dictionary", (progress) => {
      updates.push(progress);
      if (progress.completed === 2) controller.abort();
    }, controller.signal), { name: "AbortError" });
    assert.deepEqual(calls, ["second.json", "hashes.json"]);
    assert.equal(updates.at(-1)?.completed, 2);
    assert.equal(updates.at(-1)?.total, 3);
    assert.equal((await listStudyCache("dictionary")).filter((item) => item.downloaded).length, 2);
    calls.length = 0;
    await downloadAllStudyResources("dictionary");
    assert.deepEqual(calls, ["third.json", "hashes.json"]);
    assert.equal((await listStudyCache("dictionary")).filter((item) => item.downloaded).length, 3);
  });
});
