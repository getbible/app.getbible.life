import {
  defaultDictionary, dictionaryEntryTerms, getDictionaryEntry, getDictionaryIndex,
  normalizeStudyTerm, studyCacheRevision, StudyApiError,
  type DictionaryCatalog, type DictionaryEntry, type DictionaryIndexEntry, type DictionarySummary,
} from "./study-api.ts";
import { isCacheFresh } from "./cache-policy.ts";

export interface DictionaryMatch { dictionary: DictionarySummary; entries: DictionaryEntry[] }
export interface DictionarySuggestion { dictionary: DictionarySummary; entry: DictionaryIndexEntry }
export interface DictionaryLookupResult {
  matches: DictionaryMatch[]; suggestions: DictionarySuggestion[];
  unavailable: string[]; complete: boolean;
}
interface Candidate { dictionary: string; entry: DictionaryIndexEntry }
interface Engine {
  key: string; catalogKey: string; savedAt: number; refresh: boolean; entries: number; users: number;
  dictionaries: Map<string, DictionarySummary>; indexed: Set<string>; failures: Set<string>;
  words: Map<string, Candidate[]>; suggestionTerms: Set<string>; sortedTerms?: string[];
  definitions: Map<string, DictionaryEntry | null>; definitionCharacters: number;
  listeners: Set<(dictionary: string) => void>; preparation?: Promise<void>; controller?: AbortController;
}

const MAX_INDEX_ENTRIES = 400_000;
const MAX_DEFINITIONS = 256;
const MAX_DEFINITION_CHARACTERS = 2_000_000;
const CONCURRENCY = 4;
let current: Engine | undefined;
let active = 0;
const waiting: { start: () => void; cancel: () => void }[] = [];
const abortError = () => new DOMException("Dictionary lookup cancelled", "AbortError");
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) throw abortError(); };
const isAborted = (error: unknown) => error instanceof Error && error.name === "AbortError";

/** Index and definition requests share one limit, including concurrent panels/prewarming. */
async function limited<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal);
  await new Promise<void>((resolve, reject) => {
    const start = () => { signal?.removeEventListener("abort", cancel); active += 1; resolve(); };
    const cancel = () => {
      const index = waiting.findIndex((item) => item.start === start);
      if (index !== -1) waiting.splice(index, 1);
      reject(abortError());
    };
    if (active < CONCURRENCY) start();
    else { waiting.push({ start, cancel }); signal?.addEventListener("abort", cancel, { once: true }); }
  });
  try { checkAbort(signal); return await action(); }
  finally { active -= 1; waiting.shift()?.start(); }
}

function engineFor(catalog: DictionaryCatalog): Engine {
  const catalogKey = JSON.stringify([catalog.schema, catalog.generated_at,
    catalog.dictionaries.map((item) => [item.id, item.entry_count, item.unique_key_count, item.bytes])]);
  const key = `${studyCacheRevision()}/${catalogKey}`;
  if (!current || current.key !== key || !isCacheFresh(current.savedAt)) {
    // Publication changes bypass stale fragments; expiry/cache changes rebuild from the
    // persistent cache, whose own timestamps schedule background refreshes as needed.
    const refresh = Boolean(current && current.catalogKey !== catalogKey);
    current = {
      key, catalogKey, refresh, savedAt: Date.now(), entries: 0, users: 0,
      dictionaries: new Map(catalog.dictionaries.filter((item) => item.entry_count > 0).map((item) => [item.id, item])),
      indexed: new Set(), failures: new Set(), words: new Map(), suggestionTerms: new Set(),
      definitions: new Map(), definitionCharacters: 0, listeners: new Set(),
    };
  }
  return current;
}

/** Release derived session indexes after the user changes managed downloads. */
export function clearDictionaryLookup(): void {
  current?.controller?.abort();
  current = undefined;
}

/** One incremental reverse index per published catalog; chapters reuse it. */
async function addIndex(engine: Engine, dictionary: string, entries: DictionaryIndexEntry[], signal: AbortSignal) {
  if (engine.entries + entries.length > MAX_INDEX_ENTRIES) throw new StudyApiError("This dictionary index exceeds the browser cache budget.");
  engine.entries += entries.length;
  const additions = new Map<string, Candidate[]>();
  const suggestions = new Set<string>();
  try {
    for (let start = 0; start < entries.length; start += 1_000) {
      checkAbort(signal);
      for (const entry of entries.slice(start, start + 1_000)) {
        const candidate = { dictionary, entry };
        for (const term of dictionaryEntryTerms(entry)) {
          const values = additions.get(term);
          if (values) values.push(candidate); else additions.set(term, [candidate]);
        }
        const search = normalizeStudyTerm(entry.search);
        if (search) suggestions.add(search);
      }
      // Yield while large dictionaries compile so scrolling and selection remain responsive.
      if (start + 1_000 < entries.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    checkAbort(signal);
    let merged = 0;
    for (const [term, candidates] of additions) {
      checkAbort(signal);
      const values = engine.words.get(term);
      if (values) values.push(...candidates); else engine.words.set(term, candidates);
      if (++merged % 1_000 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    for (const term of suggestions) engine.suggestionTerms.add(term);
    engine.sortedTerms = undefined;
    engine.indexed.add(dictionary);
  } catch (error) {
    // Incomplete indexes never participate in matching and must not leave duplicate candidates.
    for (const term of additions.keys()) {
      const values = engine.words.get(term)?.filter((candidate) => candidate.dictionary !== dictionary);
      if (values?.length) engine.words.set(term, values); else engine.words.delete(term);
    }
    engine.entries -= entries.length;
    throw error;
  }
}

function beginPreparation(engine: Engine, language: string, strong: string[] = []): Promise<void> {
  if (engine.preparation) {
    if (engine.controller?.signal.aborted) return engine.preparation.catch(() => undefined).then(() => beginPreparation(engine, language, strong));
    return engine.preparation;
  }
  const controller = new AbortController();
  engine.controller = controller;
  const dictionaries = [...engine.dictionaries.values()].filter((item) => !engine.indexed.has(item.id) && !engine.failures.has(item.id));
  const preferred = defaultDictionary(dictionaries, language, strong);
  dictionaries.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  let position = 0;
  engine.preparation = Promise.allSettled(Array.from({ length: Math.min(CONCURRENCY, dictionaries.length) }, async () => {
    while (position < dictionaries.length) {
      checkAbort(controller.signal);
      const dictionary = dictionaries[position++];
      try {
        const index = await limited(() => getDictionaryIndex(dictionary.id, controller.signal, engine.refresh), controller.signal);
        if (!Array.isArray(index.entries)) throw new StudyApiError("Invalid dictionary index.");
        await addIndex(engine, dictionary.id, index.entries, controller.signal);
      } catch (error) {
        if (isAborted(error)) throw error;
        engine.failures.add(dictionary.id);
      }
      for (const listener of engine.listeners) listener(dictionary.id);
    }
  })).then((results) => {
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }).finally(() => { engine.preparation = undefined; engine.controller = undefined; });
  return engine.preparation;
}

async function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function release(engine: Engine) {
  engine.users -= 1;
  if (engine.users === 0) engine.controller?.abort();
}

/** Prewarm indexes only; definitions are fetched when a reader selects a word. */
export async function prewarmDictionaryLookup(catalog: DictionaryCatalog, language: string, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  const engine = engineFor(catalog);
  engine.users += 1;
  try { await waitFor(beginPreparation(engine, language), signal); }
  finally { release(engine); }
}

function candidates(engine: Engine, term: string, strong: string[]) {
  const matches = new Map<string, Map<string, DictionaryIndexEntry>>();
  for (const needle of new Set([term, ...strong].map(normalizeStudyTerm).filter(Boolean))) {
    for (const candidate of engine.words.get(needle) ?? []) {
      if (!engine.indexed.has(candidate.dictionary)) continue;
      let entries = matches.get(candidate.dictionary);
      if (!entries) { entries = new Map(); matches.set(candidate.dictionary, entries); }
      entries.set(candidate.entry.id, candidate.entry);
    }
  }
  return matches;
}

function rememberDefinition(engine: Engine, key: string, value: DictionaryEntry | null) {
  const previous = engine.definitions.get(key);
  engine.definitionCharacters -= previous?.text.length ?? 0;
  engine.definitions.delete(key);
  if (value && value.text.length > MAX_DEFINITION_CHARACTERS) return;
  engine.definitions.set(key, value);
  engine.definitionCharacters += value?.text.length ?? 0;
  while (engine.definitions.size > MAX_DEFINITIONS || engine.definitionCharacters > MAX_DEFINITION_CHARACTERS) {
    const oldest = engine.definitions.keys().next().value!;
    engine.definitionCharacters -= engine.definitions.get(oldest)?.text.length ?? 0;
    engine.definitions.delete(oldest);
  }
}

async function definition(engine: Engine, dictionary: string, id: string, signal?: AbortSignal) {
  checkAbort(signal);
  const key = `${dictionary}/${id}`;
  if (engine.definitions.has(key)) {
    const value = engine.definitions.get(key)!;
    rememberDefinition(engine, key, value);
    return value;
  }
  try {
    const entry = await limited(() => getDictionaryEntry(dictionary, id, signal, engine.refresh), signal);
    if (entry.id !== id || entry.dictionary !== dictionary) throw new StudyApiError("The dictionary returned an invalid entry.");
    const value = typeof entry.text === "string" && entry.text.trim() ? entry : null;
    rememberDefinition(engine, key, value);
    return value;
  } catch (error) {
    if (error instanceof StudyApiError && error.status === 404) { rememberDefinition(engine, key, null); return null; }
    throw error;
  }
}

function suggestions(engine: Engine, term: string, limit = 20): DictionarySuggestion[] {
  const needle = normalizeStudyTerm(term);
  if (!needle) return [];
  const keys = engine.sortedTerms ??= [...engine.suggestionTerms].sort();
  let left = 0, right = keys.length;
  while (left < right) { const middle = (left + right) >>> 1; if (keys[middle] < needle) left = middle + 1; else right = middle; }
  const results: DictionarySuggestion[] = [];
  const seen = new Set<string>();
  for (let index = left; index < keys.length && keys[index].startsWith(needle) && results.length < limit; index += 1) {
    for (const item of engine.words.get(keys[index]) ?? []) {
      const key = `${item.dictionary}/${item.entry.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ dictionary: engine.dictionaries.get(item.dictionary)!, entry: item.entry });
      if (results.length === limit) break;
    }
  }
  return results;
}

export interface DictionaryLookupOptions {
  signal?: AbortSignal; onProgress?: (result: DictionaryLookupResult) => void;
  explicit?: { dictionary: string; entry: string }; retry?: boolean; language?: string;
}

/** Picker choices are confirmed nonempty definitions, never the unfiltered catalog. */
export async function lookupDictionaries(
  catalog: DictionaryCatalog, term: string, strong: string[] = [], options: DictionaryLookupOptions = {},
): Promise<DictionaryLookupResult> {
  const { signal } = options;
  checkAbort(signal);
  const engine = engineFor(catalog);
  const matches = new Map<string, DictionaryMatch>();
  const unavailable = new Set<string>();
  const pending = new Map<string, Promise<void>>();
  const snapshot = (complete = false): DictionaryLookupResult => ({ matches: [...matches.values()], suggestions: [], unavailable: [...unavailable], complete });
  const publish = () => { if (!signal?.aborted) options.onProgress?.(snapshot()); };
  const confirm = (dictionary: string, entries: DictionaryIndexEntry[]) => {
    if (pending.has(dictionary)) return;
    const task = (async () => {
      const found: DictionaryEntry[] = [];
      for (const entry of entries) {
        checkAbort(signal);
        try { const value = await definition(engine, dictionary, entry.id, signal); if (value) found.push(value); }
        catch (error) { if (isAborted(error)) throw error; unavailable.add(dictionary); }
      }
      if (found.length) matches.set(dictionary, { dictionary: engine.dictionaries.get(dictionary)!, entries: found });
      publish();
    })();
    // Attach rejection handling immediately while shared index loading continues.
    task.catch(() => undefined);
    pending.set(dictionary, task);
  };
  if (options.explicit) {
    const resource = engine.dictionaries.get(options.explicit.dictionary);
    if (!resource) return snapshot(true);
    confirm(resource.id, [{ id: options.explicit.entry, key: term, search: normalizeStudyTerm(term) }]);
    await Promise.all(pending.values());
    return snapshot(true);
  }
  if (options.retry) engine.failures.clear();
  const ready = (dictionary: string) => {
    if (signal?.aborted) return;
    if (engine.failures.has(dictionary)) { unavailable.add(dictionary); publish(); return; }
    const entries = candidates(engine, term, strong).get(dictionary);
    if (entries?.size) confirm(dictionary, [...entries.values()]);
  };
  for (const [dictionary, entries] of candidates(engine, term, strong)) confirm(dictionary, [...entries.values()]);
  for (const dictionary of engine.failures) unavailable.add(dictionary);
  engine.listeners.add(ready);
  engine.users += 1;
  try {
    await waitFor(beginPreparation(engine, options.language ?? "en", strong), signal);
    await waitFor(Promise.all(pending.values()), signal);
    checkAbort(signal);
    return { ...snapshot(true), suggestions: matches.size ? [] : suggestions(engine, term) };
  } finally { engine.listeners.delete(ready); release(engine); }
}
