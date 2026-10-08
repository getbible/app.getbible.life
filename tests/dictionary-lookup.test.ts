import assert from "node:assert/strict";
import test from "node:test";
import { lookupDictionaries, prewarmDictionaryLookup } from "../lib/dictionary-lookup.ts";
import {
  clearStudyCache, defaultDictionary, DICTIONARIES_ROOT, findDictionaryMatches,
  normalizeStudyTerm, type DictionaryCatalog, type DictionaryEntry, type DictionaryIndex,
  type DictionaryIndexEntry, type DictionarySummary,
} from "../lib/study-api.ts";

const summary = (id: string, strong_prefix: "G" | "H" | null = null): DictionarySummary => ({
  id, name: id, language: "en", license: "Public Domain", entry_count: 1, unique_key_count: 1, bytes: 10, strong_prefix,
});
const indexEntry = (id: string, key: string, search = key, aliases?: string[]): DictionaryIndexEntry => ({ id, key, search, aliases });
const entry = (dictionary: string, id: string, text: string): DictionaryEntry => ({
  schema: "getbible-dictionary-entry-v1", dictionary, language: "en", id, key: id, occurrence: 1, aliases: [id], text,
});
const catalog = (dictionaries: DictionarySummary[], generated_at = "2026-10-08T00:00:00Z"): DictionaryCatalog => ({
  schema: "getbible-dictionaries-catalog-v1", generated_at, dictionaries,
});

async function withResources(
  indexes: Record<string, DictionaryIndexEntry[]>, definitions: Record<string, DictionaryEntry | number>,
  action: (calls: string[], cache: Map<string, Response>) => Promise<void>, delay = 0,
) {
  const originalFetch = globalThis.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const documents = new Map<string, Response>();
  const calls: string[] = [];
  Object.defineProperty(globalThis, "caches", { configurable: true, value: {
    open: async () => ({
      match: async (url: RequestInfo | URL) => documents.get(String(url))?.clone(),
      put: async (url: RequestInfo | URL, response: Response) => { documents.set(String(url), response.clone()); },
      delete: async (url: RequestInfo | URL) => documents.delete(String(url)),
    }),
    delete: async () => { documents.clear(); return true; },
  } });
  globalThis.fetch = async (input, options) => {
    const path = String(input).slice(DICTIONARIES_ROOT.length + 1);
    calls.push(path);
    if (delay) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
      const timer = setTimeout(() => { options?.signal?.removeEventListener("abort", abort); resolve(); }, delay);
      options?.signal?.addEventListener("abort", abort, { once: true });
      if (options?.signal?.aborted) abort();
    });
    if (path.endsWith("/index.json")) {
      const dictionary = path.slice(0, -"/index.json".length);
      return indexes[dictionary] ? new Response(JSON.stringify({ schema: "getbible-dictionary-index-v1", dictionary, language: "en", entries: indexes[dictionary] })) : new Response("Unavailable", { status: 503 });
    }
    const value = definitions[path];
    return typeof value === "number" ? new Response("Unavailable", { status: value }) : value ? new Response(JSON.stringify(value)) : new Response("Not found", { status: 404 });
  };
  try { await clearStudyCache(); await action(calls, documents); }
  finally {
    await clearStudyCache();
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, "caches", descriptor); else Reflect.deleteProperty(globalThis, "caches");
  }
}

test("case, accents, aliases, and Strong IDs use one cached exact index", () => {
  let reads = 0;
  const index: DictionaryIndex = { schema: "index", dictionary: "example", language: "en", get entries() {
    reads += 1;
    return [indexEntry("exact-public-ID", "Unrelated key", "FÁITH", ["BELIÉF"]), indexEntry("G4102", "04102", "04102")];
  } };
  for (const word of ["faith", "Faith", "FAITH", "Fáith.", "  FÁITH  "]) assert.equal(findDictionaryMatches(index, word)[0]?.id, "exact-public-ID");
  assert.equal(findDictionaryMatches(index, "belief")[0]?.id, "exact-public-ID");
  assert.equal(findDictionaryMatches(index, "word", ["g4102"])[0]?.id, "G4102");
  assert.equal(findDictionaryMatches(index, "g4102")[0]?.id, "G4102");
  assert.equal(findDictionaryMatches(index, "faithful").length, 0);
  assert.equal(reads, 1);
  assert.equal(normalizeStudyTerm("  HOLY\n  SPIRIT. "), "holy spirit");
});

test("picker includes only nonempty exact definitions and keeps every repeated entry", async () => {
  const resources = catalog([summary("meaning"), summary("empty"), summary("unrelated")]);
  await withResources({
    meaning: [indexEntry("exact-Public-ID", "FAITH", "faith"), indexEntry("exact-Public-ID--2", "FAITH", "faith")],
    empty: [indexEntry("k-FAITH", "FAITH", "faith")], unrelated: [indexEntry("k-FAITHFUL", "FAITHFUL", "faithful")],
  }, {
    "meaning/exact-Public-ID.json": entry("meaning", "exact-Public-ID", "Trust"),
    "meaning/exact-Public-ID--2.json": entry("meaning", "exact-Public-ID--2", "Belief"),
    "empty/k-FAITH.json": entry("empty", "k-FAITH", " \n\t"),
  }, async (calls) => {
    for (const word of ["Faith", "faith", "FAITH"]) {
      const result = await lookupDictionaries(resources, word);
      assert.deepEqual(result.matches.map((match) => match.dictionary.id), ["meaning"]);
      assert.deepEqual(result.matches[0].entries.map((item) => item.id), ["exact-Public-ID", "exact-Public-ID--2"]);
      assert.equal(result.complete, true);
      assert.deepEqual(result.unavailable, []);
    }
    assert.equal(calls.filter((path) => path.endsWith("/index.json")).length, 3);
    assert.equal(calls.filter((path) => !path.endsWith("/index.json")).length, 3);
    assert.equal(calls.some((path) => path.includes("k-FAITHFUL.json")), false);
  });
});

test("Strong definitions remain the automatic default among confirmed dictionary matches", async () => {
  const resources = catalog([summary("easton"), summary("strongsgreek", "G"), summary("empty-strong", "G")]);
  await withResources({ easton: [indexEntry("k-FAITH", "FAITH", "faith")], strongsgreek: [indexEntry("G4102", "04102", "04102")], "empty-strong": [indexEntry("G4102", "04102", "04102")] }, {
    "easton/k-FAITH.json": entry("easton", "k-FAITH", "Faith"), "strongsgreek/G4102.json": entry("strongsgreek", "G4102", "Original word"), "empty-strong/G4102.json": entry("empty-strong", "G4102", ""),
  }, async () => {
    const result = await lookupDictionaries(resources, "faith", ["G4102"]);
    assert.equal(defaultDictionary(result.matches.map((match) => match.dictionary), "en", ["G4102"], "easton"), "strongsgreek");
    const typed = await lookupDictionaries(resources, "g4102");
    assert.deepEqual(typed.matches.map((match) => match.dictionary.id), ["strongsgreek"]);
  });
});

test("index and definition outages are distinguished from no match and can be retried", async () => {
  const indexes = { published: [indexEntry("k-FAITH", "FAITH", "faith")] };
  const definitions: Record<string, DictionaryEntry | number> = { "published/k-FAITH.json": 503 };
  const resources = catalog([summary("published"), summary("missing-index")]);
  await withResources(indexes, definitions, async () => {
    const failed = await lookupDictionaries(resources, "faith");
    assert.deepEqual(failed.matches, []);
    assert.deepEqual(new Set(failed.unavailable), new Set(["published", "missing-index"]));
    definitions["published/k-FAITH.json"] = entry("published", "k-FAITH", "Faith");
    Object.assign(indexes, { "missing-index": [indexEntry("k-NOTHING", "NOTHING", "nothing")] });
    const retried = await lookupDictionaries(resources, "faith", [], { retry: true });
    assert.deepEqual(retried.matches.map((match) => match.dictionary.id), ["published"]);
    assert.deepEqual(retried.unavailable, []);
    const unmatched = await lookupDictionaries(resources, "elsewhere");
    assert.deepEqual(unmatched.matches, []);
    assert.deepEqual(unmatched.unavailable, []);
  });
});

test("prewarming reuses indexes across different words without fetching definitions", async () => {
  const resources = catalog([summary("reused")]);
  await withResources({ reused: [indexEntry("k-FAITH", "FAITH", "faith"), indexEntry("k-LOVE", "LOVE", "love")] }, {
    "reused/k-FAITH.json": entry("reused", "k-FAITH", "Faith"), "reused/k-LOVE.json": entry("reused", "k-LOVE", "Love"),
  }, async (calls) => {
    await prewarmDictionaryLookup(resources, "en");
    assert.deepEqual(calls, ["reused/index.json"]);
    await lookupDictionaries(resources, "faith"); await lookupDictionaries(resources, "love");
    assert.equal(calls.filter((path) => path.endsWith("index.json")).length, 1);
  });
});

test("cancelling an index preparation immediately allows the next word lookup to restart", async () => {
  const resources = catalog([summary("cancel")]);
  await withResources({ cancel: [indexEntry("k-FAITH", "FAITH", "faith")] }, { "cancel/k-FAITH.json": entry("cancel", "k-FAITH", "Faith") }, async () => {
    const controller = new AbortController();
    const first = prewarmDictionaryLookup(resources, "en", controller.signal);
    controller.abort();
    const next = lookupDictionaries(resources, "faith");
    await assert.rejects(first, { name: "AbortError" });
    assert.equal((await next).matches[0]?.entries[0]?.text, "Faith");
  }, 10);
});

test("catalog publication changes refresh both index matches and their cached definitions", async () => {
  const indexes = { changing: [indexEntry("public-ID", "FAITH", "faith")] };
  const definitions = { "changing/public-ID.json": entry("changing", "public-ID", "Old definition") };
  await withResources(indexes, definitions, async (calls) => {
    const resources = [summary("changing")];
    assert.equal((await lookupDictionaries(catalog(resources), "faith")).matches[0].entries[0].text, "Old definition");
    indexes.changing = [indexEntry("public-ID", "BELIEF", "belief")];
    definitions["changing/public-ID.json"] = entry("changing", "public-ID", "New definition");
    const updated = catalog(resources, "2026-10-08T01:00:00Z");
    assert.deepEqual((await lookupDictionaries(updated, "faith")).matches, []);
    assert.equal((await lookupDictionaries(updated, "belief")).matches[0].entries[0].text, "New definition");
    assert.equal(calls.filter((path) => path.endsWith("/index.json")).length, 2);
  });
});

test("explicit dictionary links keep their owning dictionary and exact entry ID", async () => {
  await withResources({}, {
    "linked/literal--2.json": entry("linked", "literal--2", "Linked definition"),
  }, async (calls) => {
    const result = await lookupDictionaries(catalog([summary("linked"), summary("other")]), "Same word", [], { explicit: { dictionary: "linked", entry: "literal--2" } });
    assert.deepEqual(result.matches.map((match) => match.dictionary.id), ["linked"]);
    assert.deepEqual(calls, ["linked/literal--2.json"]);
  });
});

test("offline bulk dictionaries confirm definitions without network access", async () => {
  await withResources({}, {}, async (_calls, documents) => {
    documents.set(`${DICTIONARIES_ROOT}/offline.json`, new Response(JSON.stringify({ schema: "getbible-dictionary-v1", dictionary: "offline", language: "en", name: "Offline", entries: [entry("offline", "Exact-ID", "Offline meaning")] })));
    globalThis.fetch = async () => { throw new Error("Offline"); };
    const result = await lookupDictionaries(catalog([summary("offline")]), "exact-id");
    assert.equal(result.matches[0].entries[0].text, "Offline meaning");
    assert.deepEqual(result.unavailable, []);
  });
});

test("dictionary index and definition traffic stays within the shared concurrency limit", async () => {
  const resources = Array.from({ length: 10 }, (_, number) => summary(`concurrent-${number}`));
  const indexes = Object.fromEntries(resources.map((item) => [item.id, [indexEntry("k-FAITH", "FAITH", "faith")]]));
  const definitions = Object.fromEntries(resources.map((item) => [`${item.id}/k-FAITH.json`, entry(item.id, "k-FAITH", "Faith")]));
  await withResources(indexes, definitions, async () => {
    const fetcher = globalThis.fetch;
    let active = 0, peak = 0;
    globalThis.fetch = async (...arguments_) => {
      active += 1; peak = Math.max(peak, active);
      try { return await fetcher(...arguments_); } finally { active -= 1; }
    };
    const result = await lookupDictionaries(catalog(resources), "faith");
    assert.equal(result.matches.length, 10);
    assert.ok(peak > 1 && peak <= 4, `Observed ${peak} concurrent dictionary requests`);
    assert.equal(active, 0);
  }, 10);
});
