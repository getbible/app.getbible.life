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
export interface DictionaryCatalog { schema: string; dictionaries: DictionarySummary[] }
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

const memory = new Map<string, { value: unknown; savedAt: number }>();
const corpusMemory = new Map<string, unknown>();
const corpusReads = new Map<string, Promise<unknown | null>>();
const MEMORY_TTL = 5 * 60 * 1_000;
const MEMORY_LIMIT = 24;
const CORPUS_LIMIT = 2;
const aborted = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError"); };
function rememberDocument(url: string, value: unknown) {
  memory.delete(url); memory.set(url, { value, savedAt: Date.now() });
  while (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value!);
}
function rememberCorpus(url: string, value: unknown) {
  corpusMemory.delete(url); corpusMemory.set(url, value);
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
  if (corpusMemory.has(url)) {
    const value = corpusMemory.get(url) as T;
    rememberCorpus(url, value);
    return value;
  }
  if (corpus && corpusReads.has(url)) return await corpusReads.get(url) as T | null;
  const read = async () => {
    try {
      const response = await (await store())?.match(url);
      const value = response ? await response.json() as T : null;
      if (value && corpus) rememberCorpus(url, value);
      return value;
    } catch { return null; }
  };
  if (!corpus) return read();
  const pending = read().finally(() => { corpusReads.delete(url); });
  corpusReads.set(url, pending);
  return pending;
}
async function network<T>(url: string, consume: (response: Response) => Promise<T>, signal?: AbortSignal, timeout = 45_000, noStore = false): Promise<T> {
  aborted(signal);
  const controller = new AbortController();
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
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
async function request<T>(url: string, signal?: AbortSignal): Promise<T> {
  aborted(signal);
  const recent = memory.get(url);
  if (recent && Date.now() - recent.savedAt < MEMORY_TTL) { memory.delete(url); memory.set(url, recent); return recent.value as T; }
  try {
    const { value, cacheResponse } = await network(url, async (response) => ({ cacheResponse: response.clone(), value: await response.json() as T }), signal);
    if (!value || typeof value !== "object") throw new StudyApiError("The study resource returned an invalid document.");
    aborted(signal);
    rememberDocument(url, value);
    try { await (await store())?.put(url, cacheResponse); } catch { /* Reading still works when storage is full or unavailable. */ }
    return value;
  } catch (error) {
    aborted(signal);
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
  return value.normalize("NFD").replace(/\p{M}/gu, "").trim().toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}
export function findDictionaryMatches(index: DictionaryIndex, term: string, strong: string[] = []): DictionaryIndexEntry[] {
  const needles = new Set(strong.map(normalizeStudyTerm).filter(Boolean));
  const normalized = normalizeStudyTerm(term);
  return index.entries.filter((entry) =>
    needles.has(normalizeStudyTerm(entry.id)) ||
    (entry.aliases ?? []).some((alias) => needles.has(normalizeStudyTerm(alias))) ||
    (normalized !== "" && (entry.search === normalized || normalizeStudyTerm(entry.key) === normalized || (entry.aliases ?? []).some((alias) => normalizeStudyTerm(alias) === normalized)))
  );
}
export function dictionarySuggestions(index: DictionaryIndex, term: string, limit = 20): DictionaryIndexEntry[] {
  const normalized = normalizeStudyTerm(term);
  return normalized ? index.entries.filter((entry) => entry.search.startsWith(normalized)).slice(0, limit) : [];
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

export async function getDictionaryIndex(id: string, signal?: AbortSignal): Promise<DictionaryIndex> {
  aborted(signal);
  const whole = await saved<WholeDictionary>(`${DICTIONARIES_ROOT}/${segment(id)}.json`, true);
  aborted(signal);
  if (whole?.entries) return {
    schema: "getbible-dictionary-index-v1", dictionary: id, language: whole.language,
    entries: whole.entries.map((entry) => ({ id: entry.id, key: entry.key, search: normalizeStudyTerm(entry.key), aliases: entry.aliases, occurrence: entry.occurrence })),
  };
  return request<DictionaryIndex>(`${DICTIONARIES_ROOT}/${segment(id)}/index.json`, signal);
}
export async function getDictionaryEntry(id: string, entry: string, signal?: AbortSignal): Promise<DictionaryEntry> {
  aborted(signal);
  const whole = await saved<WholeDictionary>(`${DICTIONARIES_ROOT}/${segment(id)}.json`, true);
  aborted(signal);
  const found = whole?.entries?.find((item) => item.id === entry);
  return found ?? request<DictionaryEntry>(`${DICTIONARIES_ROOT}/${segment(id)}/${segment(entry)}.json`, signal);
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

export interface StudyTextSegment { text: string; reference?: ScriptureReference }
/** Numeric book addressing keeps citations usable across reader languages. */
export function scriptureReferenceQuery(reference: ScriptureReference): string {
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
/** Link only published citation strings; plain text is preserved byte-for-byte. */
export function studyTextSegments(text: string, references: ScriptureReference[] = []): StudyTextSegment[] {
  const ranges: { start: number; end: number; reference: ScriptureReference }[] = [];
  for (const reference of references) {
    if (!reference.text) continue;
    let start = text.indexOf(reference.text);
    while (start !== -1) {
      const end = start + reference.text.length;
      const before = text[start - 1] ?? "", after = text[end] ?? "";
      // A published John 1:1 citation must not link the prefix of John 1:10.
      const startsInWord = /[\p{L}\p{N}]/u.test(reference.text[0]) && /[\p{L}\p{N}]/u.test(before);
      const endsInWord = /[\p{L}\p{N}]/u.test(reference.text.at(-1) ?? "") && /[\p{L}\p{N}]/u.test(after);
      const continuesRange = /\d/u.test(reference.text.at(-1) ?? "") && /^[-–,:]\s*\d/u.test(text.slice(end));
      if (!startsInWord && !endsInWord && !continuesRange) ranges.push({ start, end, reference });
      start = text.indexOf(reference.text, start + reference.text.length);
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: StudyTextSegment[] = [];
  let position = 0;
  for (const range of ranges) {
    if (range.start < position) continue;
    if (range.start > position) result.push({ text: text.slice(position, range.start) });
    result.push({ text: text.slice(range.start, range.end), reference: range.reference });
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

type ResourceKind = "dictionary" | "commentary";
const resourceRoot = (kind: ResourceKind) => kind === "dictionary" ? DICTIONARIES_ROOT : COMMENTARIES_ROOT;
export async function isStudyDownloaded(kind: ResourceKind, id: string): Promise<boolean> {
  return Boolean(await (await store())?.match(`${resourceRoot(kind)}/${segment(id)}.json`));
}
export async function removeStudyDownload(kind: ResourceKind, id: string): Promise<void> {
  const url = `${resourceRoot(kind)}/${segment(id)}.json`;
  await (await store())?.delete(url); memory.delete(url); corpusMemory.delete(url);
}
export async function clearStudyCache(): Promise<void> {
  memory.clear(); corpusMemory.clear(); corpusReads.clear();
  if (typeof caches !== "undefined") await caches.delete(STUDY_CACHE_NAME);
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    for (const key of keys) if (key?.startsWith("getbible-study:")) localStorage.removeItem(key);
  } catch { /* Browser preferences can be unavailable in a private session. */ }
}

/** Store the whole published document atomically only after SHA-256 verification. */
async function download<T>(root: string, path: string, manifestPath: string, signal?: AbortSignal): Promise<T> {
  const cache = await store();
  if (!cache) throw new StudyApiError("Offline storage is unavailable in this browser.");
  if (!globalThis.crypto?.subtle) throw new StudyApiError("This browser cannot verify offline downloads.");
  const url = `${root}/${path}`;
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
    const value = JSON.parse(new TextDecoder().decode(bytes)) as T;
    aborted(signal);
    await cache.put(url, new Response(bytes, { headers: { "content-type": "application/json", "x-getbible-sha256": digest } }));
    rememberCorpus(url, value);
    return value;
  }
  throw new StudyApiError("The download could not be verified.");
}
export const downloadDictionary = (id: string, signal?: AbortSignal) => download<WholeDictionary>(DICTIONARIES_ROOT, `${segment(id)}.json`, "hashes.json", signal);
export const downloadCommentary = (id: string, signal?: AbortSignal) => download<WholeCommentary>(COMMENTARIES_ROOT, `${segment(id)}.json`, "hashes.json", signal);
export const downloadBookmarkCatalog = (signal?: AbortSignal) => download<BookmarkAll>(BOOKMARKS_ROOT, "all.json", "checksums.json", signal);
