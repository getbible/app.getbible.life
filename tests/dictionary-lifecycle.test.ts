import assert from "node:assert/strict";
import test from "node:test";
import { lookupDictionaries, prewarmDictionaryLookup } from "../lib/dictionary-lookup.ts";
import {
  clearStudyCache, DICTIONARIES_ROOT, isStudyDownloaded, STUDY_CACHE_NAME,
  type DictionaryCatalog, type DictionaryEntry,
} from "../lib/study-api.ts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function catalog(id: string, generatedAt = "2026-10-08T12:00:00Z"): DictionaryCatalog {
  return {
    schema: "getbible-dictionaries-v1", generated_at: generatedAt,
    dictionaries: [{ id, name: id, language: "en", license: "Public Domain", entry_count: 1,
      unique_key_count: 1, strong_prefix: null, bytes: 500 }],
  };
}

function indexResponse(id: string, key = "Love") {
  return new Response(JSON.stringify({ schema: "getbible-dictionary-index-v1", dictionary: id,
    language: "en", entries: [{ id: "entry", key, search: key.toLowerCase() }] }));
}

function entryResponse(id: string, key = "Love", text = "An exact definition.") {
  const entry: DictionaryEntry = { schema: "getbible-dictionary-entry-v1", dictionary: id,
    language: "en", id: "entry", key, occurrence: 1, aliases: [], text };
  return new Response(JSON.stringify(entry));
}

function storage(mode: "normal" | "denied" | "full" = "normal") {
  const values = new Map<string, Response>();
  const cache = {
    match: async (url: RequestInfo | URL) => values.get(String(url))?.clone(),
    put: async (url: RequestInfo | URL, response: Response) => {
      if (mode === "full") throw new DOMException("Quota exhausted", "QuotaExceededError");
      values.set(String(url), response.clone());
    },
    delete: async (url: RequestInfo | URL) => values.delete(String(url)),
  } as unknown as Cache;
  return {
    open: async (name: string) => {
      assert.equal(name, STUDY_CACHE_NAME);
      if (mode === "denied") throw new DOMException("Storage denied", "SecurityError");
      return cache;
    },
    delete: async (name: string) => { assert.equal(name, STUDY_CACHE_NAME); values.clear(); return true; },
  } as unknown as CacheStorage;
}

async function withNetwork(cache: CacheStorage, fetcher: typeof fetch, action: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", { value: cache, configurable: true });
  globalThis.fetch = fetcher;
  try { await clearStudyCache(); await action(); }
  finally {
    await clearStudyCache();
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, "caches", descriptor);
    else Reflect.deleteProperty(globalThis, "caches");
  }
}

test("a replacement lookup waits for cancelled preparation and restarts its unfinished index", { timeout: 5_000 }, async () => {
  const id = "lifecycle-restart";
  const started = deferred<void>(), aborted = deferred<void>(), cancelledRequest = deferred<Response>();
  let indexRequests = 0;
  await withNetwork(storage(), async (url, options) => {
    if (String(url) === `${DICTIONARIES_ROOT}/${id}/index.json`) {
      indexRequests += 1;
      if (indexRequests === 1) {
        options?.signal?.addEventListener("abort", () => aborted.resolve(), { once: true });
        started.resolve();
        return cancelledRequest.promise;
      }
      return indexResponse(id);
    }
    assert.equal(String(url), `${DICTIONARIES_ROOT}/${id}/entry.json`);
    return entryResponse(id);
  }, async () => {
    const controller = new AbortController();
    const warming = prewarmDictionaryLookup(catalog(id), "en", controller.signal);
    const rejected = assert.rejects(warming, { name: "AbortError" });
    await started.promise;
    controller.abort();
    await rejected;
    await aborted.promise;
    const replacement = lookupDictionaries(catalog(id), "LOVE");
    assert.equal(indexRequests, 1, "replacement must await settlement of the aborted worker");
    cancelledRequest.reject(new DOMException("Cancelled", "AbortError"));
    const result = await replacement;
    assert.equal(result.complete, true);
    assert.deepEqual(result.unavailable, []);
    assert.equal(result.matches[0]?.entries[0].text, "An exact definition.");
    assert.equal(indexRequests, 2);
  });
});

test("aborting prewarming leaves a concurrent word lookup's shared index request alive", { timeout: 5_000 }, async () => {
  const id = "lifecycle-shared";
  const started = deferred<void>(), response = deferred<Response>();
  let indexRequests = 0, networkAborted = false;
  await withNetwork(storage(), async (url, options) => {
    if (String(url).endsWith("/index.json")) {
      indexRequests += 1;
      options?.signal?.addEventListener("abort", () => { networkAborted = true; }, { once: true });
      started.resolve();
      return response.promise;
    }
    return entryResponse(id);
  }, async () => {
    const controller = new AbortController();
    const warming = prewarmDictionaryLookup(catalog(id), "en", controller.signal);
    const rejected = assert.rejects(warming, { name: "AbortError" });
    await started.promise;
    const lookup = lookupDictionaries(catalog(id), "love");
    controller.abort();
    await rejected;
    assert.equal(networkAborted, false, "one consumer must not cancel another consumer's request");
    response.resolve(indexResponse(id));
    const result = await lookup;
    assert.equal(result.matches[0]?.dictionary.id, id);
    assert.equal(indexRequests, 1);
  });
});

test("a new catalog generation replaces cached headwords and definitions even when resource counts match", async () => {
  const id = "lifecycle-generation";
  let generation = 1, indexRequests = 0, entryRequests = 0;
  await withNetwork(storage(), async (url) => {
    const key = generation === 1 ? "Love" : "Grace";
    if (String(url).endsWith("/index.json")) { indexRequests += 1; return indexResponse(id, key); }
    entryRequests += 1;
    return entryResponse(id, key, `Generation ${generation}`);
  }, async () => {
    const first = await lookupDictionaries(catalog(id), "love");
    assert.equal(first.matches[0]?.entries[0].text, "Generation 1");
    generation = 2;
    const updatedCatalog = catalog(id, "2026-10-08T12:05:00Z");
    const next = await lookupDictionaries(updatedCatalog, "GRACE");
    assert.equal(next.matches[0]?.entries[0].text, "Generation 2");
    assert.equal((await lookupDictionaries(updatedCatalog, "love")).matches.length, 0);
    assert.equal(indexRequests, 2);
    assert.equal(entryRequests, 2);
  });
});

test("clearing study caches cancels active work and a fresh lookup cannot return its stale entry", { timeout: 5_000 }, async () => {
  const id = "lifecycle-clear";
  const started = deferred<void>();
  let phase = 1, indexRequests = 0;
  await withNetwork(storage(), async (url, options) => {
    if (String(url).endsWith("/index.json")) {
      indexRequests += 1;
      if (phase === 1) {
        return new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
          started.resolve();
        });
      }
      return indexResponse(id, "Grace");
    }
    return entryResponse(id, "Grace", "Fresh after clearing.");
  }, async () => {
    let publishedDefinitions = 0;
    const stale = lookupDictionaries(catalog(id), "love", [], {
      onProgress: (result) => { publishedDefinitions += result.matches.length; },
    });
    const rejected = assert.rejects(stale, { name: "AbortError" });
    await started.promise;
    await clearStudyCache();
    await rejected;
    phase = 2;
    const fresh = await lookupDictionaries(catalog(id), "grace");
    assert.equal(fresh.matches[0]?.entries[0].text, "Fresh after clearing.");
    assert.equal((await lookupDictionaries(catalog(id), "love")).matches.length, 0);
    assert.equal(publishedDefinitions, 0);
    assert.equal(indexRequests, 2);
  });
});

test("denied or full Cache Storage still supplies online definitions and reuses session indexes", async () => {
  for (const mode of ["denied", "full"] as const) {
    const id = `lifecycle-storage-${mode}`;
    let requests = 0;
    await withNetwork(storage(mode), async (url) => {
      requests += 1;
      return String(url).endsWith("/index.json") ? indexResponse(id) : entryResponse(id);
    }, async () => {
      const first = await lookupDictionaries(catalog(id), "love");
      const again = await lookupDictionaries(catalog(id), "LOVE");
      assert.equal(first.matches[0]?.entries[0].text, "An exact definition.");
      assert.equal(again.matches[0]?.entries[0].text, "An exact definition.");
      assert.equal(await isStudyDownloaded("dictionary", id), false);
      assert.equal(requests, 2, "repeat lookup should not refetch an index or verified definition");
    });
  }
});
