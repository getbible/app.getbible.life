import { API_ROOT, fresh, validSha } from "./getbible.ts";
import type { Book, Chapter, ChapterInfo, Translation, WholeTranslation } from "./getbible.ts";

// The v3 namespace never reads or deletes old v2 bodies or personal reader data.
const CACHE = "getbible-reader-api-v3";
const META = "getbible-reader:meta:api-v3";
type HashSet = { checkedAt:number; hashes:Record<string,string> };
type Metadata = {
  version:3;
  translations:HashSet;
  books:Record<string,HashSet>;
  chapters:Record<string,HashSet>;
  loaded:Record<string,string>;
  full:Record<string,string>;
  fullChecked:Record<string,number>;
};
export type Result<T> = { data:T; cached:boolean; verified:boolean; persisted?:boolean };
type Saved<T> = { data:T; persisted:boolean };
const memory = new Map<string,Saved<unknown>>();
function remember<T>(url:string,saved:Saved<T>):void {
  memory.delete(url);memory.set(url,saved);
  // Keep chapter reads fast without retaining every downloaded corpus in RAM.
  const corpora=[...memory.keys()].filter(key=>key.startsWith(`${API_ROOT}/`) && /^[a-z0-9_-]+\.json$/.test(key.slice(API_ROOT.length+1)) && !key.endsWith("/translations.json"));
  while (corpora.length>2) memory.delete(corpora.shift()!);
  while (memory.size>64) memory.delete(memory.keys().next().value!);
}
const blank = ():Metadata => ({version:3,translations:{checkedAt:0,hashes:{}},books:{},chapters:{},loaded:{},full:{},fullChecked:{}});
let memoryMetadata = blank();

function metadata():Metadata {
  try {
    const data = JSON.parse(localStorage.getItem(META) || "null") as Metadata|null;
    if (data?.version === 3) memoryMetadata = { ...blank(), ...data };
  } catch { /* Reader access remains usable when storage is disabled. */ }
  return memoryMetadata;
}
function save(data:Metadata):void {
  memoryMetadata = data;
  try { localStorage.setItem(META,JSON.stringify(data)); } catch { /* Session memory remains available. */ }
}
async function read<T>(url:string):Promise<Saved<T>|null> {
  const inMemory = memory.get(url);
  if (inMemory) { remember(url,inMemory);return inMemory as Saved<T>; }
  try {
    const response = await (await caches.open(CACHE)).match(url);
    if (!response) return null;
    const saved = { data:await response.json() as T, persisted:true };
    remember(url,saved);
    return saved;
  } catch { return null; }
}
async function write<T>(url:string,data:T,bytes?:ArrayBuffer):Promise<boolean> {
  const saved:Saved<T> = { data, persisted:false };
  remember(url,saved);
  try {
    await (await caches.open(CACHE)).put(url,new Response(bytes ?? JSON.stringify(data),{
      headers:{"content-type":"application/json"},
    }));
    saved.persisted = true;
  } catch { /* A quota or CacheStorage error must not discard a successful request. */ }
  return saved.persisted;
}
function cached<T>(saved:Saved<T>,verified=false):Result<T> {
  return {data:saved.data,cached:true,verified,persisted:saved.persisted};
}
function translationId(value:string):string {
  const normalized=value.toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,29}$/.test(normalized)) throw new Error("Invalid translation identifier");
  return normalized;
}
function position(value:number):number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid Scripture position");
  return value;
}
async function request(url:string,timeout=30_000):Promise<{bytes:ArrayBuffer;response:Response}> {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetch(url,{cache:"no-store",headers:{accept:"application/json"},signal:controller.signal});
    if (!response.ok) {
      const detail=await response.json().catch(()=>null) as {detail?:string}|null;
      throw new Error(detail?.detail || `GetBible returned HTTP ${response.status}`);
    }
    return {bytes:await response.arrayBuffer(),response};
  } catch(error) {
    if (controller.signal.aborted) throw new Error("GetBible request timed out. Please try again.");
    throw error;
  } finally { clearTimeout(timer); }
}
function decode<T>(bytes:ArrayBuffer):T { return JSON.parse(new TextDecoder().decode(bytes)) as T; }
async function network<T>(url:string):Promise<{data:T;bytes:ArrayBuffer}> {
  const {bytes}=await request(url);
  return {data:decode<T>(bytes),bytes};
}
async function sourceHash(url:string):Promise<string> {
  const {bytes}=await request(url,15_000);
  const sha=new TextDecoder().decode(bytes).trim().toLowerCase();
  if (!validSha(sha)) throw new Error("GetBible returned an invalid content hash");
  return sha;
}
async function verifiedDocument<T>(url:string,sha:string,timeout=30_000):Promise<{data:T;bytes:ArrayBuffer;verified:boolean}> {
  const {bytes}=await request(url,timeout);
  let verified=false;
  if (globalThis.crypto?.subtle) {
    const digest=await globalThis.crypto.subtle.digest("SHA-1",bytes);
    const actual=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
    if (actual !== sha.toLowerCase()) throw new Error("GetBible content changed during download. Please try again.");
    verified=true;
  }
  return {data:decode<T>(bytes),bytes,verified};
}
const hashes = <T extends {sha:string}>(record:Record<string,T>):Record<string,string> =>
  Object.fromEntries(Object.entries(record).map(([key,value])=>[key,value.sha]));

function invalidateLoaded(meta:Metadata,prefix:string):void {
  for (const key of Object.keys(meta.loaded)) if (key.startsWith(prefix)) delete meta.loaded[key];
}

function fullTrusted(meta:Metadata,abbr:string):boolean {
  const sha=meta.full[abbr];
  return !!sha && validSha(sha) && fresh(meta.fullChecked[abbr] || 0) &&
    (!meta.translations.hashes[abbr] || meta.translations.hashes[abbr] === sha);
}
async function savedTranslation(abbr:string):Promise<Saved<WholeTranslation>|null> {
  const saved=await read<WholeTranslation>(`${API_ROOT}/${abbr}.json`);
  return saved && Array.isArray(saved.data.books) ? saved : null;
}
function chapterFromTranslation(data:WholeTranslation,book:number,nr:number):Chapter|null {
  const sourceBook=data.books.find(item=>item.nr===book);
  const sourceChapter=sourceBook?.chapters.find(item=>item.chapter===nr);
  if (!sourceBook || !sourceChapter) return null;
  return {
    ...sourceChapter,
    translation:data.translation,
    abbreviation:data.abbreviation,
    language:data.language,
    lang:data.lang,
    direction:data.direction,
    encoding:data.encoding,
    book_nr:sourceBook.nr,
    book_name:sourceBook.name,
  };
}
function booksFromTranslation(data:WholeTranslation):Record<string,Book> {
  return Object.fromEntries(data.books.map(book=>[String(book.nr),{
    nr:book.nr,name:book.name,direction:data.direction,sha:"",url:`${API_ROOT}/${data.abbreviation}/${book.nr}.json`,
  }]));
}
function chaptersFromTranslation(data:WholeTranslation,book:number):Record<string,ChapterInfo>|null {
  const source=data.books.find(item=>item.nr===book);
  if (!source) return null;
  // Empty source-introduction chapters have no published standalone chapter address.
  return Object.fromEntries(source.chapters.filter(chapter=>chapter.verses.length>0).map(chapter=>[String(chapter.chapter),{
    chapter:chapter.chapter,name:chapter.name,sha:"",url:`${API_ROOT}/${data.abbreviation}/${book}/${chapter.chapter}.json`,
  }]));
}

export async function translations():Promise<Result<Record<string,Translation>>> {
  const url=`${API_ROOT}/translations.json`,meta=metadata(),saved=await read<Record<string,Translation>>(url);
  if (saved && fresh(meta.translations.checkedAt)) return cached(saved,true);
  try {
    const {data,bytes}=await network<Record<string,Translation>>(url);
    const next=metadata(),updated=hashes(data);
    for (const [abbr,previous] of Object.entries(next.translations.hashes)) {
      if (updated[abbr]===previous) continue;
      // Expire verification only. The old bodies remain available if refresh fails offline.
      if (next.books[abbr]) next.books[abbr].checkedAt=0;
      for (const [key,index] of Object.entries(next.chapters)) if (key.startsWith(`${abbr}/`)) index.checkedAt=0;
      next.fullChecked[abbr]=0;
      invalidateLoaded(next,`${abbr}/`);
    }
    next.translations={checkedAt:Date.now(),hashes:updated};
    save(next);
    const persisted=await write(url,data,bytes);
    return {data,cached:false,verified:true,persisted};
  } catch(error) { if (saved) return cached(saved); throw error; }
}

export async function books(translation:string):Promise<Result<Record<string,Book>>> {
  const abbr=translationId(translation),url=`${API_ROOT}/${abbr}/books.json`;
  const full=await savedTranslation(abbr),meta=metadata();
  if (full && fullTrusted(meta,abbr)) return {data:booksFromTranslation(full.data),cached:true,verified:true,persisted:full.persisted};
  const saved=await read<Record<string,Book>>(url);
  if (saved && fresh(meta.books[abbr]?.checkedAt || 0)) return cached(saved,true);
  try {
    const {data,bytes}=await network<Record<string,Book>>(url),next=metadata(),updated=hashes(data);
    for (const [book,previous] of Object.entries(next.books[abbr]?.hashes || {})) {
      if (updated[book]===previous) continue;
      const key=`${abbr}/${book}`;
      if (next.chapters[key]) next.chapters[key].checkedAt=0;
      next.fullChecked[abbr]=0;
      invalidateLoaded(next,`${key}/`);
    }
    next.books[abbr]={checkedAt:Date.now(),hashes:updated};save(next);
    const persisted=await write(url,data,bytes);
    return {data,cached:false,verified:true,persisted};
  } catch(error) {
    if (saved) return cached(saved);
    if (full) return {data:booksFromTranslation(full.data),cached:true,verified:false,persisted:full.persisted};
    throw error;
  }
}

export async function chapters(translation:string,book:number):Promise<Result<Record<string,ChapterInfo>>> {
  const abbr=translationId(translation);position(book);
  const key=`${abbr}/${book}`,url=`${API_ROOT}/${key}/chapters.json`;
  const full=await savedTranslation(abbr),fromFull=full && chaptersFromTranslation(full.data,book),meta=metadata();
  if (fromFull && fullTrusted(meta,abbr)) return {data:fromFull,cached:true,verified:true,persisted:full?.persisted};
  const saved=await read<Record<string,ChapterInfo>>(url);
  if (saved && fresh(meta.chapters[key]?.checkedAt || 0)) return cached(saved,true);
  try {
    const {data,bytes}=await network<Record<string,ChapterInfo>>(url),next=metadata(),updated=hashes(data);
    for (const [nr,previous] of Object.entries(next.chapters[key]?.hashes || {})) {
      if (updated[nr]!==previous) delete next.loaded[`${key}/${nr}`];
    }
    next.chapters[key]={checkedAt:Date.now(),hashes:updated};save(next);
    const persisted=await write(url,data,bytes);
    return {data,cached:false,verified:true,persisted};
  } catch(error) {
    if (saved) return cached(saved);
    if (fromFull) return {data:fromFull,cached:true,verified:false,persisted:full?.persisted};
    throw error;
  }
}

export async function chapter(translation:string,book:number,nr:number):Promise<Result<Chapter>> {
  const abbr=translationId(translation);position(book);position(nr);
  const key=`${abbr}/${book}/${nr}`,url=`${API_ROOT}/${key}.json`;
  const full=await savedTranslation(abbr),fromFull=full && chapterFromTranslation(full.data,book,nr);
  if (fromFull && fullTrusted(metadata(),abbr)) return {data:fromFull,cached:true,verified:true,persisted:full?.persisted};
  const saved=await read<Chapter>(url);
  try {
    if (fromFull) {
      const wholeHash=await sourceHash(`${API_ROOT}/${abbr}.sha`);
      if (metadata().full[abbr] === wholeHash) {
        const next=metadata();next.fullChecked[abbr]=Date.now();save(next);
        return {data:fromFull,cached:true,verified:true,persisted:full?.persisted};
      }
    }
    const sha=await sourceHash(`${API_ROOT}/${key}.sha`);
    if (saved && metadata().loaded[key] === sha) return cached(saved,true);
    const {data,bytes,verified}=await verifiedDocument<Chapter>(url,sha);
    const persisted=await write(url,data,bytes),next=metadata();
    if (verified) next.loaded[key]=sha;
    save(next);
    return {data,cached:false,verified,persisted};
  } catch(error) {
    if (saved) return cached(saved);
    if (fromFull) return {data:fromFull,cached:true,verified:false,persisted:full?.persisted};
    throw error;
  }
}

/** Download and store one complete source file; never fetch chapters individually. */
export async function fullTranslation(translation:string,expectedSha:string):Promise<Result<WholeTranslation>> {
  const abbr=translationId(translation),url=`${API_ROOT}/${abbr}.json`,saved=await savedTranslation(abbr);
  if (saved && validSha(expectedSha) && metadata().full[abbr] === expectedSha.toLowerCase() && fullTrusted(metadata(),abbr)) return cached(saved,true);
  try {
    // Catalogue entries may be stale; the resource's own hash is authoritative.
    const sha=await sourceHash(`${API_ROOT}/${abbr}.sha`);
    if (saved && metadata().full[abbr] === sha) {
      const next=metadata();next.fullChecked[abbr]=Date.now();save(next);
      return cached(saved,true);
    }
    const {data,bytes,verified}=await verifiedDocument<WholeTranslation>(url,sha,180_000);
    if (data.abbreviation !== abbr || !Array.isArray(data.books)) throw new Error("GetBible returned an invalid translation document");
    const persisted=await write(url,data,bytes),next=metadata();
    if (verified) { next.full[abbr]=sha;next.fullChecked[abbr]=Date.now(); }
    if (next.books[abbr]) next.books[abbr].checkedAt=0;
    for (const [key,value] of Object.entries(next.chapters)) if (key.startsWith(`${abbr}/`)) value.checkedAt=0;
    save(next);
    return {data,cached:false,verified,persisted};
  } catch(error) { if (saved) return cached(saved);throw error; }
}

export async function fullTranslationAvailable(translation:string):Promise<boolean> {
  return (await savedTranslation(translationId(translation)))?.persisted === true;
}
export async function clearCache():Promise<void> {
  memory.clear();memoryMetadata=blank();
  try { localStorage.removeItem(META); } catch { /* Storage may be disabled. */ }
  try { await caches.delete(CACHE); } catch { /* No persistent cache is available. */ }
}
