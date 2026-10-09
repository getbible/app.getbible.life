import { isCacheFresh } from "./cache-policy.ts";

/** Public study-resource contracts. All resources are read-only JSON documents. */
export const DICTIONARIES_ROOT = "https://dictionaries.getbible.net/v1";
export const COMMENTARIES_ROOT = "https://commentaries.getbible.net/v1";
export const BOOKMARKS_ROOT = "https://bookmarks.getbible.net/v1";
export const STUDY_CACHE_NAME = "getbible-study-v1";

export interface ScriptureReference {
  ref: string; osis: string; book: number; chapter: number;
  verse?: number; verses?: number[]; text?: string;
}
export interface DictionarySummary {
  id: string; name: string; language: string; license: string;
  entry_count: number; unique_key_count: number; strong_prefix: "G" | "H" | null; bytes: number;
}
export interface DictionaryCatalog { schema: string; generated_at?: string; dictionaries: DictionarySummary[] }
export interface DictionaryIndexEntry { id: string; key: string; search: string; aliases?: string[]; occurrence?: number }
export interface DictionaryIndex { schema: string; dictionary: string; language: string; entries: DictionaryIndexEntry[] }
export interface DictionaryEntry {
  schema: string; dictionary: string; language: string; id: string; key: string;
  occurrence: number; aliases: string[]; text: string;
  see_also?: { id: string; key: string }[]; backlinks?: { id: string; key: string }[];
  references?: ScriptureReference[];
}
export interface WholeDictionary { schema: string; dictionary: string; language: string; name: string; entries: DictionaryEntry[] }
export interface CommentarySummary {
  id: string; name: string; language: string; license: string;
  book_count: number; chapter_count: number; entry_count: number; bytes: number;
}
export interface CommentaryCatalog { schema: string; commentaries: CommentarySummary[] }
export interface CommentaryEntry {
  book: number; chapter: number; verse: number; verses?: number[]; osis?: string;
  text: string; references?: ScriptureReference[];
}
export interface CommentaryChapter {
  schema: string; commentary: string; language: string; book: number; name: string; chapter: number; entries: CommentaryEntry[];
}
export interface CommentaryBook { schema: string; commentary: string; language: string; book: number; name: string; chapters: CommentaryChapter[] }
export interface WholeCommentary { schema: string; commentary: string; language: string; name: string; books: CommentaryBook[] }
export interface CommentaryBooks {
  schema: string; commentary: string; language: string; name: string;
  books: { book: number; name: string; chapters: number[]; entry_count: number }[];
}
export interface StudyMetadata {
  id: string; name: string; language: string; license: string; bytes: number;
  copyright?: string; copyright_holder?: string; distribution_notes?: string;
  source?: string; source_module_url?: string; about?: string;
}

export type BookmarkCoordinate = [number, number, number];
export interface BookmarkTopicSummary { id: string; name: string; color: string; aliases: string[]; default: boolean; verses: number }
export interface BookmarkCatalogTopic extends Omit<BookmarkTopicSummary, "verses"> { verses: BookmarkCoordinate[] }
export interface BookmarkTopic extends BookmarkCatalogTopic { schema_version: 1; names: Record<string, string> }
export interface BookmarkTopics { schema_version: 1; topics: BookmarkTopicSummary[] }
export interface BookmarkCatalog { schema_version: 1; topics: BookmarkCatalogTopic[] }
export interface BookmarkLocale { schema_version: 1; locale: string; name?: string; topics: Record<string, string> }
export interface BookmarkAll extends BookmarkCatalog { locales: Record<string, BookmarkLocale> }
export interface BookmarkIndex {
  schema_version: 1; catalog_version: number; checksum: string;
  counts: { topics: number; verses: number; locales: number }; resources: Record<string, string>; locales: string[];
}
export interface BookmarkChapter { schema_version: 1; book: number; chapter: number; verses: Record<string, string[]> }

export class StudyApiError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.name = "StudyApiError"; this.status = status; }
}

type CachedDocument = { value: unknown; savedAt: number };
const memory = new Map<string, CachedDocument>();
const corpusMemory = new Map<string, CachedDocument>();
const corpusReads = new Map<string, Promise<unknown | null>>();
const wholeDictionaryIndexes = new WeakMap<WholeDictionary, DictionaryIndex>();
const wholeDictionaryEntries = new WeakMap<WholeDictionary, Map<string, DictionaryEntry>>();
const activeRequests = new Map<AbortController, string>();
const refreshes = new Map<string, Promise<unknown>>();
const resourceRevisions = new Map<string, number>();
let writes: Promise<unknown> = Promise.resolve();
let activeRefreshes = 0;
const waitingRefreshes: (() => void)[] = [];
let cacheGeneration = 0;
let dictionaryRevision = 0;
/** Derived word indexes must follow clear/download/remove operations too. */
export const studyCacheRevision = () => `${cacheGeneration}/${dictionaryRevision}`;
const MEMORY_LIMIT = 24;
const CORPUS_LIMIT = 2;
const CACHED_AT = "x-getbible-cached-at";
const CACHE_BYTES = "x-getbible-cache-bytes";
const aborted = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError"); };
const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
function writeCache<T>(action: () => Promise<T>): Promise<T> {
  const result = writes.then(action, action);
  writes = result.catch(() => {});
  return result;
}
function revision(url: string) {
  return `${cacheGeneration}/${[...resourceRevisions].filter(([prefix]) => url === `${prefix}.json` || url.startsWith(`${prefix}/`)).map(([, value]) => value).join("/")}`;
}
function rememberDocument(url: string, value: unknown, savedAt = Date.now()) {
  memory.delete(url); memory.set(url, { value, savedAt });
  while (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value!);
}
function rememberCorpus(url: string, value: unknown, savedAt = Date.now()) {
  corpusMemory.delete(url); corpusMemory.set(url, { value, savedAt });
  while (corpusMemory.size > CORPUS_LIMIT) corpusMemory.delete(corpusMemory.keys().next().value!);
}
const segment = (id: string) => {
  if (!id || id === "." || id === ".." || /[/\\\u0000-\u001f]/.test(id)) throw new StudyApiError("Invalid resource identifier.");
  return encodeURIComponent(id);
};
const coordinate = (value: number, minimum: number, maximum?: number) => {
  if (!Number.isSafeInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) throw new StudyApiError("Invalid scripture coordinate.");
  return value;
};
async function store(): Promise<Cache | null> {
  try { return typeof caches !== "undefined" ? await caches.open(STUDY_CACHE_NAME) : null; } catch { return null; }
}
async function saved<T>(url: string, corpus = false): Promise<T | null> {
  const generation = revision(url);
  const recent = (corpus ? corpusMemory : memory).get(url);
  if (recent) {
    if (corpus) rememberCorpus(url, recent.value, recent.savedAt);
    else rememberDocument(url, recent.value, recent.savedAt);
    if (!isCacheFresh(recent.savedAt)) refreshInBackground(url, corpus);
    return recent.value as T;
  }
  if (corpus && corpusReads.has(url)) return await corpusReads.get(url) as T | null;
  const read = async () => {
    try {
      const response = await (await store())?.match(url);
      const value = response ? await response.json() as T : null;
      if (generation !== revision(url)) return null;
      if (value && response) {
        const savedAt = Number(response.headers.get(CACHED_AT)) || 0;
        if (corpus) rememberCorpus(url, value, savedAt);
        else rememberDocument(url, value, savedAt);
        if (!isCacheFresh(savedAt)) refreshInBackground(url, corpus);
      }
      return value;
    } catch { return null; }
  };
  if (!corpus) return read();
  const pending = read().finally(() => { if (corpusReads.get(url) === pending) corpusReads.delete(url); });
  corpusReads.set(url, pending);
  return pending;
}
async function network<T>(url: string, consume: (response: Response) => Promise<T>, signal?: AbortSignal, timeout = 45_000, noStore = false): Promise<T> {
  aborted(signal);
  const controller = new AbortController();
  activeRequests.set(controller, url);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: noStore ? "no-store" : "default", headers: { accept: "application/json" } });
    if (!response.ok) throw new StudyApiError(response.status === 404 ? "This resource has no published entry here." : `Study resource returned HTTP ${response.status}.`, response.status);
    const value = await consume(response);
    aborted(signal);
    return value;
  } catch (error) {
    aborted(signal);
    if (timedOut) throw new StudyApiError("The study request timed out. Please try again.");
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); activeRequests.delete(controller); }
}
async function fetchDocument<T>(url: string, signal?: AbortSignal): Promise<T> {
  const generation = revision(url);
  const { value, text } = await network(url, async (response) => {
    const text = await response.text();
    return { text, value: JSON.parse(text) as T };
  }, signal, 45_000, true);
  if (!value || typeof value !== "object") throw new StudyApiError("The study resource returned an invalid document.");
  aborted(signal);
  if (generation !== revision(url)) throw new DOMException("Request cancelled", "AbortError");
  const savedAt = Date.now();
  rememberDocument(url, value, savedAt);
  try {
    await writeCache(async () => {
      const cache = await store();
      if (generation !== revision(url)) return;
      await cache?.put(url, new Response(text, { headers: {
        "content-type": "application/json", [CACHED_AT]: String(savedAt), [CACHE_BYTES]: String(new TextEncoder().encode(text).byteLength),
      } }));
    });
  } catch { /* Reading still works when storage is full or unavailable. */ }
  if (generation !== revision(url)) throw new DOMException("Request cancelled", "AbortError");
  return value;
}
function refreshInBackground(url: string, corpus: boolean) {
  if (!online() || refreshes.has(url)) return;
  const generation = revision(url);
  const pending = (async () => {
    await new Promise<void>((resolve) => {
      const start = () => { activeRefreshes += 1; resolve(); };
      if (activeRefreshes < 3) start(); else waitingRefreshes.push(start);
    });
    try {
      if (!online() || generation !== revision(url)) return;
      // Full modules retain checksum verification when their timestamp expires.
      if (corpus) {
        const root = [DICTIONARIES_ROOT, COMMENTARIES_ROOT, BOOKMARKS_ROOT].find((candidate) => url.startsWith(`${candidate}/`));
        if (root) return await download(root, url.slice(root.length + 1), root === BOOKMARKS_ROOT ? "checksums.json" : "hashes.json");
      }
      const value = await fetchDocument(url);
      if (url.startsWith(`${DICTIONARIES_ROOT}/`)) dictionaryRevision += 1;
      return value;
    } finally {
      activeRefreshes -= 1;
      waitingRefreshes.shift()?.();
    }
  })().catch(() => { /* Stale content remains usable while offline or during an upstream failure. */ }).finally(() => {
    if (refreshes.get(url) === pending) refreshes.delete(url);
  });
  refreshes.set(url, pending);
}
async function request<T>(url: string, signal?: AbortSignal, refresh = false): Promise<T> {
  aborted(signal);
  if (!refresh) {
    const cached = await saved<T>(url);
    aborted(signal);
    if (cached) return cached;
  }
  try {
    return await fetchDocument<T>(url, signal);
  } catch (error) {
    aborted(signal);
    if (error instanceof Error && error.name === "AbortError") throw error;
    // A removed document must not be resurrected from a stale online cache.
    if (error instanceof StudyApiError && error.status === 404) throw error;
    const offline = await saved<T>(url);
    aborted(signal);
    if (offline) return offline;
    throw error;
  }
}

export const getDictionaryCatalog = (signal?: AbortSignal) => request<DictionaryCatalog>(`${DICTIONARIES_ROOT}/dictionaries.json`, signal);
export const getDictionaryMetadata = (id: string, signal?: AbortSignal) => request<StudyMetadata>(`${DICTIONARIES_ROOT}/${segment(id)}/metadata.json`, signal);
export const getCommentaryCatalog = (signal?: AbortSignal) => request<CommentaryCatalog>(`${COMMENTARIES_ROOT}/commentaries.json`, signal);
export const getCommentaryMetadata = (id: string, signal?: AbortSignal) => request<StudyMetadata>(`${COMMENTARIES_ROOT}/${segment(id)}/metadata.json`, signal);

export function normalizeStudyTerm(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}
/** Match published headwords/aliases/IDs, never substrings or guessed inflections. */
export function dictionaryEntryTerms(entry: DictionaryIndexEntry): string[] {
  return [...new Set([entry.search, entry.key, entry.id, ...(entry.aliases ?? [])].map(normalizeStudyTerm).filter(Boolean))];
}
const dictionaryLookups = new WeakMap<DictionaryIndex, Map<string, DictionaryIndexEntry[]>>();
function dictionaryLookup(index: DictionaryIndex) {
  let lookup = dictionaryLookups.get(index);
  if (!lookup) {
    lookup = new Map();
    for (const entry of index.entries) for (const key of dictionaryEntryTerms(entry)) {
      const values = lookup.get(key);
      if (values) values.push(entry); else lookup.set(key, [entry]);
    }
    dictionaryLookups.set(index, lookup);
  }
  return lookup;
}
export function findDictionaryMatches(index: DictionaryIndex, term: string, strong: string[] = []): DictionaryIndexEntry[] {
  const lookup = dictionaryLookup(index);
  const results = new Map<string, DictionaryIndexEntry>();
  for (const needle of [term, ...strong].map(normalizeStudyTerm).filter(Boolean)) {
    for (const entry of lookup.get(needle) ?? []) results.set(entry.id, entry);
  }
  return [...results.values()];
}
export function dictionarySuggestions(index: DictionaryIndex, term: string, limit = 20): DictionaryIndexEntry[] {
  const normalized = normalizeStudyTerm(term);
  return normalized ? index.entries.filter((entry) => normalizeStudyTerm(entry.search).startsWith(normalized)).slice(0, limit) : [];
}
export function defaultDictionary(dictionaries: DictionarySummary[], language: string, strong: string[] = [], remembered?: string | null): string {
  const locale = language.toLowerCase().split("-")[0];
  const prefixes = new Set(strong.map((token) => /^[GH]/i.exec(token)?.[0].toUpperCase()).filter(Boolean));
  const previous = dictionaries.find((dictionary) => dictionary.id === remembered);
  if (previous && (!prefixes.size || (previous.strong_prefix && prefixes.has(previous.strong_prefix)))) return previous.id;
  const score = (dictionary: DictionarySummary) => {
    const sameLanguage = dictionary.language.toLowerCase().split("-")[0] === locale;
    const lexical = dictionary.strong_prefix && prefixes.has(dictionary.strong_prefix);
    return (lexical ? 1_000 : 0) + (sameLanguage ? 500 : dictionary.language === "en" ? 100 : 0) +
      (!prefixes.size && !dictionary.strong_prefix ? 50 : 0) +
      (["easton", "strongsgreek", "strongshebrew"].includes(dictionary.id) ? 10 : 0);
  };
  return [...dictionaries].filter((dictionary) => dictionary.entry_count > 0).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))[0]?.id ?? "";
}

export async function getDictionaryIndex(id: string, signal?: AbortSignal, refresh = false): Promise<DictionaryIndex> {
  aborted(signal);
  const whole = await saved<WholeDictionary>(`${DICTIONARIES_ROOT}/${segment(id)}.json`, true);
  aborted(signal);
  if (whole?.entries) {
    let index = wholeDictionaryIndexes.get(whole);
    if (!index) {
      index = {
        schema: "getbible-dictionary-index-v1", dictionary: id, language: whole.language,
        entries: whole.entries.map((entry) => ({ id: entry.id, key: entry.key, search: normalizeStudyTerm(entry.key), aliases: entry.aliases, occurrence: entry.occurrence })),
      };
      wholeDictionaryIndexes.set(whole, index);
    }
    return index;
  }
  return request<DictionaryIndex>(`${DICTIONARIES_ROOT}/${segment(id)}/index.json`, signal, refresh);
}
export async function getDictionaryEntry(id: string, entry: string, signal?: AbortSignal, refresh = false): Promise<DictionaryEntry> {
  aborted(signal);
  const whole = await saved<WholeDictionary>(`${DICTIONARIES_ROOT}/${segment(id)}.json`, true);
  aborted(signal);
  let entries = whole ? wholeDictionaryEntries.get(whole) : undefined;
  if (whole?.entries && !entries) { entries = new Map(whole.entries.map((item) => [item.id, item])); wholeDictionaryEntries.set(whole, entries); }
  const found = entries?.get(entry);
  return found ?? request<DictionaryEntry>(`${DICTIONARIES_ROOT}/${segment(id)}/${segment(entry)}.json`, signal, refresh);
}
export async function getCommentaryBooks(id: string, signal?: AbortSignal): Promise<CommentaryBooks> {
  aborted(signal);
  const whole = await saved<WholeCommentary>(`${COMMENTARIES_ROOT}/${segment(id)}.json`, true);
  aborted(signal);
  if (whole?.books) return {
    schema: "getbible-commentary-books-v1", commentary: id, name: whole.name, language: whole.language,
    books: whole.books.map((book) => ({ book: book.book, name: book.name, chapters: book.chapters.map((chapter) => chapter.chapter), entry_count: book.chapters.reduce((count, chapter) => count + chapter.entries.length, 0) })),
  };
  return request<CommentaryBooks>(`${COMMENTARIES_ROOT}/${segment(id)}/books.json`, signal);
}
export async function getCommentaryChapter(id: string, book: number, chapter: number, signal?: AbortSignal): Promise<CommentaryChapter> {
  coordinate(book, 1, 83); coordinate(chapter, 0);
  aborted(signal);
  const whole = await saved<WholeCommentary>(`${COMMENTARIES_ROOT}/${segment(id)}.json`, true);
  aborted(signal);
  const found = whole?.books?.find((item) => item.book === book)?.chapters.find((item) => item.chapter === chapter);
  return found ?? request<CommentaryChapter>(`${COMMENTARIES_ROOT}/${segment(id)}/${book}/${chapter}.json`, signal);
}
export function commentsForVerse(entries: CommentaryEntry[], verse?: number): CommentaryEntry[] {
  return verse === undefined ? entries : entries.filter((entry) => entry.verse === 0 || (entry.verses ?? [entry.verse]).includes(verse));
}

export interface StudyTextSegment { text: string; references?: ScriptureReference[] }
/** Source documents may contain introductions or malformed coordinates, neither is a verse link. */
export function isReadableScriptureReference(reference: ScriptureReference): boolean {
  return Number.isSafeInteger(reference.book) && reference.book >= 1 && reference.book <= 83 &&
    Number.isSafeInteger(reference.chapter) && reference.chapter > 0 &&
    (reference.verse === undefined || (Number.isSafeInteger(reference.verse) && reference.verse > 0)) &&
    (reference.verses === undefined || (Array.isArray(reference.verses) && reference.verses.every((verse) => Number.isSafeInteger(verse) && verse > 0)));
}
/** Numeric book addressing keeps citations usable across reader languages. */
export function scriptureReferenceQuery(reference: ScriptureReference): string {
  if (!isReadableScriptureReference(reference)) throw new StudyApiError("Invalid scripture reference.");
  const verses = [...new Set(reference.verses ?? (reference.verse === undefined ? [] : [reference.verse]))].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < verses.length; index += 1) {
    const start = verses[index];
    let end = start;
    while (index + 1 < verses.length && verses[index + 1] === end + 1) end = verses[++index];
    ranges.push(start === end ? String(start) : `${start}-${end}`);
  }
  return `${reference.book} ${reference.chapter}${ranges.length ? `:${ranges.join(",")}` : ""}`;
}
/** One published link can identify several passages; preserve each one in source order. */
export function scriptureReferencesQuery(references: ScriptureReference[]): string {
  return [...new Set(references.filter(isReadableScriptureReference).map(scriptureReferenceQuery))].join(";");
}
/** Link only published citation strings; plain text is preserved byte-for-byte. */
export function studyTextSegments(text: string, references: ScriptureReference[] = []): StudyTextSegment[] {
  const groups = new Map<string, ScriptureReference[]>();
  for (const reference of references) {
    if (!reference.text || !isReadableScriptureReference(reference)) continue;
    const group = groups.get(reference.text) ?? [];
    group.push(reference); groups.set(reference.text, group);
  }
  const ranges: { start: number; end: number; references: ScriptureReference[] }[] = [];
  for (const [label, group] of groups) {
    let start = text.indexOf(label);
    while (start !== -1) {
      const end = start + label.length;
      const before = text[start - 1] ?? "", after = text[end] ?? "";
      // A published John 1:1 citation must not link the prefix of John 1:10.
      const startsInWord = /[\p{L}\p{N}]/u.test(label[0]) && /[\p{L}\p{N}]/u.test(before);
      const endsInWord = /[\p{L}\p{N}]/u.test(label.at(-1) ?? "") && /[\p{L}\p{N}]/u.test(after);
      const continuesRange = /\d/u.test(label.at(-1) ?? "") && /^[-–,:]\s*\d/u.test(text.slice(end));
      if (!startsInWord && !endsInWord && !continuesRange) ranges.push({ start, end, references: group });
      start = text.indexOf(label, start + label.length);
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: StudyTextSegment[] = [];
  let position = 0;
  for (const range of ranges) {
    if (range.start < position) continue;
    if (range.start > position) result.push({ text: text.slice(position, range.start) });
    result.push({ text: text.slice(range.start, range.end), references: range.references });
    position = range.end;
  }
  if (position < text.length || !result.length) result.push({ text: text.slice(position) });
  return result;
}

export const getBookmarkIndex = (signal?: AbortSignal) => request<BookmarkIndex>(`${BOOKMARKS_ROOT}/index.json`, signal);
export async function getBookmarkTopics(signal?: AbortSignal): Promise<BookmarkTopics> {
  aborted(signal);
  const whole = await saved<BookmarkAll>(`${BOOKMARKS_ROOT}/all.json`, true);
  aborted(signal);
  return whole?.topics ? { schema_version: 1, topics: whole.topics.map((topic) => ({ ...topic, verses: topic.verses.length })) } : request<BookmarkTopics>(`${BOOKMARKS_ROOT}/topics.json`, signal);
}
export async function getBookmarkTopic(id: string, signal?: AbortSignal): Promise<BookmarkTopic> {
  segment(id); aborted(signal);
  const whole = await saved<BookmarkAll>(`${BOOKMARKS_ROOT}/all.json`, true);
  aborted(signal);
  const topic = whole?.topics?.find((item) => item.id === id);
  if (topic) return {
    ...topic, schema_version: 1,
    names: { en: topic.name, ...Object.fromEntries(Object.entries(whole?.locales ?? {}).flatMap(([locale, document]) => document.topics[id] ? [[locale, document.topics[id]]] : [])) },
  };
  return request<BookmarkTopic>(`${BOOKMARKS_ROOT}/topics/${segment(id)}.json`, signal);
}
export const getBookmarkCatalog = (signal?: AbortSignal) => request<BookmarkCatalog>(`${BOOKMARKS_ROOT}/catalog.json`, signal);
export const getBookmarkAll = (signal?: AbortSignal) => request<BookmarkAll>(`${BOOKMARKS_ROOT}/all.json`, signal);
export async function getBookmarkLocale(locale: string, signal?: AbortSignal): Promise<BookmarkLocale> {
  const code = locale.toLowerCase(); segment(code); aborted(signal);
  const whole = await saved<BookmarkAll>(`${BOOKMARKS_ROOT}/all.json`, true);
  aborted(signal);
  return whole?.locales?.[code] ?? request<BookmarkLocale>(`${BOOKMARKS_ROOT}/locales/${segment(code)}.json`, signal);
}
export const getBookmarkChapter = (book: number, chapter: number, signal?: AbortSignal) => request<BookmarkChapter>(`${BOOKMARKS_ROOT}/verses/${coordinate(book, 1, 66)}/${coordinate(chapter, 1, 150)}.json`, signal);

export type ResourceKind = "dictionary" | "commentary";
const resourceRoot = (kind: ResourceKind) => kind === "dictionary" ? DICTIONARIES_ROOT : COMMENTARIES_ROOT;
export interface StudyCacheStatus {
  kind: ResourceKind; id: string; downloaded: boolean; documents: number; bytes: number; savedAt: number;
}
export interface StudyDownloadProgress { completed: number; total: number; id: string; name: string; bytes: number }
export async function listStudyCache(kind?: ResourceKind): Promise<StudyCacheStatus[]> {
  const cache = await store();
  if (!cache) return [];
  const resources = new Map<string, StudyCacheStatus>();
  for (const request of await cache.keys()) {
    const resourceKind = (["dictionary", "commentary"] as const).find((item) => (!kind || kind === item) && request.url.startsWith(`${resourceRoot(item)}/`));
    if (!resourceKind) continue;
    const path = request.url.slice(resourceRoot(resourceKind).length + 1);
    const part = path.split("/")[0];
    if (["dictionaries.json", "commentaries.json", "hashes.json"].includes(part)) continue;
    const id = decodeURIComponent(part.replace(/\.json$/, ""));
    const response = await cache.match(request);
    if (!response) continue;
    const savedAt = Number(response.headers.get(CACHED_AT)) || 0;
    const key = `${resourceKind}/${id}`;
    const status = resources.get(key) ?? { kind: resourceKind, id, downloaded: false, documents: 0, bytes: 0, savedAt };
    status.downloaded ||= path === part && part.endsWith(".json");
    status.documents += 1;
    status.bytes += Number(response.headers.get(CACHE_BYTES)) || Number(response.headers.get("content-length")) || 0;
    status.savedAt = Math.min(status.savedAt, savedAt);
    resources.set(key, status);
  }
  return [...resources.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}
export async function isStudyDownloaded(kind: ResourceKind, id: string): Promise<boolean> {
  return Boolean(await (await store())?.match(`${resourceRoot(kind)}/${segment(id)}.json`));
}
async function removeCachedResources(prefix: string): Promise<void> {
  const matches = (url: string) => url === `${prefix}.json` || url.startsWith(`${prefix}/`);
  resourceRevisions.set(prefix, (resourceRevisions.get(prefix) ?? 0) + 1);
  for (const [controller, url] of activeRequests) if (matches(url)) controller.abort();
  for (const collection of [memory, corpusMemory, corpusReads, refreshes]) for (const url of collection.keys()) if (matches(url)) collection.delete(url);
  await writeCache(async () => {
    const cache = await store();
    if (!cache) return;
    const urls = (await cache.keys()).map((request) => request.url);
    await Promise.all(urls.filter(matches).map((url) => cache.delete(url)));
  });
}
/** Removing a resource also clears previously read fragments and derived indexes. */
export async function removeStudyDownload(kind: ResourceKind, id: string): Promise<void> {
  if (kind === "dictionary") dictionaryRevision += 1;
  await removeCachedResources(`${resourceRoot(kind)}/${segment(id)}`);
}
export async function clearStudyCache(kind?: ResourceKind): Promise<void> {
  if (kind) {
    if (kind === "dictionary") dictionaryRevision += 1;
    await removeCachedResources(resourceRoot(kind));
    return;
  }
  cacheGeneration += 1;
  for (const controller of activeRequests.keys()) controller.abort();
  memory.clear(); corpusMemory.clear(); corpusReads.clear(); refreshes.clear(); resourceRevisions.clear();
  await writeCache(async () => { if (typeof caches !== "undefined") await caches.delete(STUDY_CACHE_NAME); });
  // Cache management must not reset the user's preferred dictionaries/commentaries.
}

/** Store the whole published document atomically only after SHA-256 verification. */
async function download<T>(root: string, path: string, manifestPath: string, signal?: AbortSignal): Promise<T> {
  const url = `${root}/${path}`;
  const generation = revision(url);
  const cache = await store();
  if (!cache) throw new StudyApiError("Offline storage is unavailable in this browser.");
  if (!globalThis.crypto?.subtle) throw new StudyApiError("This browser cannot verify offline downloads.");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    aborted(signal);
    const [bytes, manifest] = await Promise.all([
      network(url, (response) => response.arrayBuffer(), signal, 180_000, true),
      network(`${root}/${manifestPath}`, (response) => response.json() as Promise<{ files: Record<string, string> }>, signal, 45_000, true),
    ]);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (digest !== manifest.files?.[path]) {
      if (attempt === 0) continue;
      throw new StudyApiError("The resource changed during download. Please try again.");
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" ||
      (root === DICTIONARIES_ROOT && (!("entries" in value) || !Array.isArray(value.entries))) ||
      (root === COMMENTARIES_ROOT && (!("books" in value) || !Array.isArray(value.books))) ||
      (root === BOOKMARKS_ROOT && (!("topics" in value) || !Array.isArray(value.topics)))) {
      throw new StudyApiError("The downloaded resource has an invalid document structure.");
    }
    aborted(signal);
    if (generation !== revision(url)) throw new DOMException("Request cancelled", "AbortError");
    const savedAt = Date.now();
    await writeCache(async () => {
      if (generation !== revision(url)) throw new DOMException("Request cancelled", "AbortError");
      await cache.put(url, new Response(bytes, { headers: {
        "content-type": "application/json", "x-getbible-sha256": digest, [CACHED_AT]: String(savedAt), [CACHE_BYTES]: String(bytes.byteLength),
      } }));
    });
    if (generation !== revision(url)) throw new DOMException("Request cancelled", "AbortError");
    rememberCorpus(url, value, savedAt);
    if (root === DICTIONARIES_ROOT) dictionaryRevision += 1;
    return value as T;
  }
  throw new StudyApiError("The download could not be verified.");
}
export const downloadDictionary = (id: string, signal?: AbortSignal) => download<WholeDictionary>(DICTIONARIES_ROOT, `${segment(id)}.json`, "hashes.json", signal);
export const downloadCommentary = (id: string, signal?: AbortSignal) => download<WholeCommentary>(COMMENTARIES_ROOT, `${segment(id)}.json`, "hashes.json", signal);
export const downloadBookmarkCatalog = (signal?: AbortSignal) => download<BookmarkAll>(BOOKMARKS_ROOT, "all.json", "checksums.json", signal);

/** Download sequentially to keep large verified modules within the browser's memory budget. */
export async function downloadAllStudyResources(kind: ResourceKind, onProgress?: (progress: StudyDownloadProgress) => void, signal?: AbortSignal): Promise<void> {
  const resources = kind === "dictionary" ? (await getDictionaryCatalog(signal)).dictionaries : (await getCommentaryCatalog(signal)).commentaries;
  const available = resources.filter((resource) => resource.entry_count > 0);
  let completed = 0, bytes = 0;
  for (const resource of available) {
    aborted(signal);
    onProgress?.({ completed, total: available.length, id: resource.id, name: resource.name, bytes });
    const cached = await (await store())?.match(`${resourceRoot(kind)}/${segment(resource.id)}.json`);
    if (!cached || !isCacheFresh(Number(cached.headers.get(CACHED_AT)) || 0)) {
      await (kind === "dictionary" ? downloadDictionary : downloadCommentary)(resource.id, signal);
    }
    completed += 1;
    bytes += resource.bytes;
    onProgress?.({ completed, total: available.length, id: resource.id, name: resource.name, bytes });
  }
}
