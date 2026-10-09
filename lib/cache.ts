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
  loadedChecked:Record<string,number>;
  full:Record<string,string>;
  fullChecked:Record<string,number>;
  downloaded:Record<string,Translation>;
};
export type Result<T> = { data:T; cached:boolean; verified:boolean; persisted?:boolean };
type Saved<T> = { data:T; persisted:boolean; savedAt:number; bytes:number; sha:string };
export type DownloadedTranslation = { abbreviation:string; name:string; savedAt:number; bytes:number; refreshing:boolean };
const CACHED_AT = "x-getbible-cached-at";
const CACHE_BYTES = "x-getbible-cache-bytes";
const CACHE_SHA = "x-getbible-sha";
const memory = new Map<string,Saved<unknown>>();
const pending = new Map<string,{controller:AbortController;result:Promise<Result<unknown>>}>();
const failedRefreshes = new Map<string,number>();
function remember<T>(url:string,saved:Saved<T>):void {
  memory.delete(url);memory.set(url,saved);
  // Keep chapter reads fast without retaining every downloaded corpus in RAM.
  const corpora=[...memory.keys()].filter(key=>key.startsWith(`${API_ROOT}/`) && /^[a-z0-9_-]+\.json$/.test(key.slice(API_ROOT.length+1)) && !key.endsWith("/translations.json"));
  while (corpora.length>2) memory.delete(corpora.shift()!);
  while (memory.size>64) memory.delete(memory.keys().next().value!);
}
const blank = ():Metadata => ({version:3,translations:{checkedAt:0,hashes:{}},books:{},chapters:{},loaded:{},loadedChecked:{},full:{},fullChecked:{},downloaded:{}});
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
    const saved = { data:await response.json() as T, persisted:true, savedAt:Number(response.headers.get(CACHED_AT)) || 0, bytes:Number(response.headers.get(CACHE_BYTES)) || 0, sha:response.headers.get(CACHE_SHA) || "" };
    remember(url,saved);
    return saved;
  } catch { return null; }
}
async function write<T>(url:string,data:T,bytes?:ArrayBuffer,signal?:AbortSignal,sha=""):Promise<boolean> {
  signal?.throwIfAborted();
  const body=bytes ?? new TextEncoder().encode(JSON.stringify(data)).buffer;
  const saved:Saved<T> = { data, persisted:false, savedAt:Date.now(), bytes:body.byteLength, sha };
  remember(url,saved);
  try {
    await (await caches.open(CACHE)).put(url,new Response(body,{
      headers:{"content-type":"application/json",[CACHED_AT]:String(saved.savedAt),[CACHE_BYTES]:String(saved.bytes),[CACHE_SHA]:sha},
    }));
    saved.persisted = true;
  } catch { /* A quota or CacheStorage error must not discard a successful request. */ }
  signal?.throwIfAborted();
  return saved.persisted;
}
async function revalidated<T>(url:string,saved:Saved<T>,signal:AbortSignal):Promise<boolean> {
  signal.throwIfAborted();
  saved.savedAt=Date.now();
  try {
    const cache=await caches.open(CACHE),response=await cache.match(url);
    if (!response || response.headers.get(CACHE_SHA)!==saved.sha) return false;
    const headers=new Headers(response.headers);headers.set(CACHED_AT,String(saved.savedAt));
    // Keep the exact verified source bytes, including whitespace, on a hash-only refresh.
    await cache.put(url,new Response(response.body,{headers}));
  } catch { /* The unchanged, previously saved body remains valid if a timestamp write fails. */ }
  signal.throwIfAborted();
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
const offline = ():boolean => globalThis.navigator?.onLine === false;
function position(value:number):number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid Scripture position");
  return value;
}
async function request(url:string,timeout=30_000,signal?:AbortSignal):Promise<{bytes:ArrayBuffer;response:Response}> {
  const controller=new AbortController();
  signal?.throwIfAborted();
  const abort=()=>controller.abort();
  signal?.addEventListener("abort",abort,{once:true});
  const timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetch(url,{cache:"no-store",headers:{accept:"application/json"},signal:controller.signal});
    if (!response.ok) {
      const detail=await response.json().catch(()=>null) as {detail?:string}|null;
      throw new Error(detail?.detail || `GetBible returned HTTP ${response.status}`);
    }
    return {bytes:await response.arrayBuffer(),response};
  } catch(error) {
    signal?.throwIfAborted();
    if (controller.signal.aborted) throw new Error("GetBible request timed out. Please try again.");
    throw error;
  } finally { clearTimeout(timer);signal?.removeEventListener("abort",abort); }
}
function decode<T>(bytes:ArrayBuffer):T { return JSON.parse(new TextDecoder().decode(bytes)) as T; }
async function network<T>(url:string,signal?:AbortSignal):Promise<{data:T;bytes:ArrayBuffer}> {
  const {bytes}=await request(url,30_000,signal);
  return {data:decode<T>(bytes),bytes};
}
async function sourceHash(url:string,signal?:AbortSignal):Promise<string> {
  const {bytes}=await request(url,15_000,signal);
  const sha=new TextDecoder().decode(bytes).trim().toLowerCase();
  if (!validSha(sha)) throw new Error("GetBible returned an invalid content hash");
  return sha;
}
async function verifiedDocument<T>(url:string,sha:string,timeout=30_000,signal?:AbortSignal):Promise<{data:T;bytes:ArrayBuffer;verified:boolean}> {
  const {bytes}=await request(url,timeout,signal);
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
  for (const key of Object.keys(meta.loaded)) if (key.startsWith(prefix)) { delete meta.loaded[key];meta.loadedChecked[key]=0; }
}

function run<T>(url:string,work:(signal:AbortSignal)=>Promise<Result<T>>):Promise<Result<T>> {
  const existing=pending.get(url);
  if (existing) return existing.result as Promise<Result<T>>;
  const controller=new AbortController();
  const result=work(controller.signal).then(value=>{failedRefreshes.delete(url);return value;}).catch(error=>{
    if (!controller.signal.aborted) failedRefreshes.set(url,Date.now());
    throw error;
  }).finally(()=>{if(pending.get(url)?.result===result) pending.delete(url);});
  pending.set(url,{controller,result});
  return result;
}
function background<T>(url:string,work:()=>Promise<T>):void {
  if (offline() || Date.now()-(failedRefreshes.get(url) || 0)<60_000) return;
  void work().catch(()=>undefined);
}

function fullTrusted(meta:Metadata,abbr:string,saved:Saved<WholeTranslation>):boolean {
  const sha=meta.full[abbr];
  return !!sha && validSha(sha) && saved.sha===sha && fresh(meta.fullChecked[abbr] || 0) &&
    (!meta.translations.hashes[abbr] || meta.translations.hashes[abbr] === sha);
}
async function savedTranslation(abbr:string):Promise<Saved<WholeTranslation>|null> {
  const saved=await read<WholeTranslation>(`${API_ROOT}/${abbr}.json`);
  return saved && Array.isArray(saved.data.books) ? saved : null;
}
function translationFromDownload(data:WholeTranslation,sha:string):Translation {
  // The startup catalogue needs distribution information, not the entire corpus.
  const summary=Object.fromEntries(Object.entries(data).filter(([key])=>!["books","titles","introduction"].includes(key)));
  return {...summary,sha} as Translation;
}
async function downloadedTranslations():Promise<Result<Record<string,Translation>>|null> {
  const meta=metadata(),data:Record<string,Translation>={};
  const candidates=new Set([...Object.keys(meta.downloaded),...Object.keys(meta.full)]);
  const addUrl=(url:string)=>{
    const match=url.startsWith(`${API_ROOT}/`) && url.slice(API_ROOT.length+1).match(/^([a-z0-9][a-z0-9_-]{0,29})\.json$/);
    if (match && match[1]!=="translations") candidates.add(match[1]);
  };
  for (const url of memory.keys()) addUrl(url);
  try {
    // Recover downloads made by earlier releases, including after catalogue or
    // localStorage eviction. CacheStorage owns the actual offline availability.
    for (const request of await (await caches.open(CACHE)).keys()) addUrl(request.url);
  } catch { /* Session downloads remain usable without persistent storage. */ }
  let persisted=true;
  for (const abbr of candidates) {
    const saved=await savedTranslation(abbr);
    if (!saved || saved.data.abbreviation!==abbr) continue;
    data[abbr]=meta.downloaded[abbr] ?? translationFromDownload(saved.data,meta.full[abbr] || "");
    persisted &&= saved.persisted;
  }
  return Object.keys(data).length ? {data,cached:true,verified:false,persisted} : null;
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

function refreshTranslations():Promise<Result<Record<string,Translation>>> {
  const url=`${API_ROOT}/translations.json`;
  return run(url,async(signal)=>{
    const {data,bytes}=await network<Record<string,Translation>>(url,signal);
    const persisted=await write(url,data,bytes,signal),next=metadata(),updated=hashes(data);
    for (const [abbr,previous] of Object.entries(next.translations.hashes)) {
      if (updated[abbr]===previous) continue;
      // Expire verification only. Old bodies remain readable during refresh.
      if (next.books[abbr]) next.books[abbr].checkedAt=0;
      for (const [key,index] of Object.entries(next.chapters)) if (key.startsWith(`${abbr}/`)) index.checkedAt=0;
      next.fullChecked[abbr]=0;
      invalidateLoaded(next,`${abbr}/`);
    }
    next.translations={checkedAt:Date.now(),hashes:updated};save(next);
    return {data,cached:false,verified:true,persisted};
  });
}

export async function translations():Promise<Result<Record<string,Translation>>> {
  const url=`${API_ROOT}/translations.json`,meta=metadata(),saved=await read<Record<string,Translation>>(url);
  if (saved) {
    const current=fresh(meta.translations.checkedAt);
    if (!current) background(url,refreshTranslations);
    return cached(saved,current);
  }
  // A downloaded Bible contains everything required to start reading. Catalogue
  // refresh must never delay startup, even when a connection looks online but stalls.
  const downloaded=await downloadedTranslations();
  if (downloaded) { background(url,refreshTranslations);return downloaded; }
  return refreshTranslations();
}

function refreshBooks(abbr:string):Promise<Result<Record<string,Book>>> {
  const url=`${API_ROOT}/${abbr}/books.json`;
  return run(url,async(signal)=>{
    const {data,bytes}=await network<Record<string,Book>>(url,signal);
    const persisted=await write(url,data,bytes,signal),next=metadata(),updated=hashes(data);
    for (const [book,previous] of Object.entries(next.books[abbr]?.hashes || {})) {
      if (updated[book]===previous) continue;
      const key=`${abbr}/${book}`;
      if (next.chapters[key]) next.chapters[key].checkedAt=0;
      next.fullChecked[abbr]=0;
      invalidateLoaded(next,`${key}/`);
    }
    next.books[abbr]={checkedAt:Date.now(),hashes:updated};save(next);
    return {data,cached:false,verified:true,persisted};
  });
}

function refreshDownloaded(abbr:string,saved:Saved<WholeTranslation>):void {
  const meta=metadata();
  const catalogueChanged=!!meta.full[abbr] && (meta.full[abbr]!==saved.sha || (!!meta.translations.hashes[abbr] && meta.full[abbr]!==meta.translations.hashes[abbr]));
  if (!fresh(meta.fullChecked[abbr] ?? saved.savedAt) || catalogueChanged) {
    background(`${API_ROOT}/${abbr}.json`,()=>refreshFullTranslation(abbr,saved));
  }
}

export async function books(translation:string):Promise<Result<Record<string,Book>>> {
  const abbr=translationId(translation),url=`${API_ROOT}/${abbr}/books.json`,full=await savedTranslation(abbr);
  if (full) {
    refreshDownloaded(abbr,full);
    return {data:booksFromTranslation(full.data),cached:true,verified:fullTrusted(metadata(),abbr,full),persisted:full.persisted};
  }
  const saved=await read<Record<string,Book>>(url);
  if (saved) {
    const current=fresh(metadata().books[abbr]?.checkedAt ?? saved.savedAt);
    if (!current) background(url,()=>refreshBooks(abbr));
    return cached(saved,current);
  }
  return refreshBooks(abbr);
}

function refreshChapters(abbr:string,book:number):Promise<Result<Record<string,ChapterInfo>>> {
  const key=`${abbr}/${book}`,url=`${API_ROOT}/${key}/chapters.json`;
  return run(url,async(signal)=>{
    const {data,bytes}=await network<Record<string,ChapterInfo>>(url,signal);
    const persisted=await write(url,data,bytes,signal),next=metadata(),updated=hashes(data);
    for (const [nr,previous] of Object.entries(next.chapters[key]?.hashes || {})) {
      if (updated[nr]!==previous) {delete next.loaded[`${key}/${nr}`];next.loadedChecked[`${key}/${nr}`]=0;}
    }
    next.chapters[key]={checkedAt:Date.now(),hashes:updated};save(next);
    return {data,cached:false,verified:true,persisted};
  });
}

export async function chapters(translation:string,book:number):Promise<Result<Record<string,ChapterInfo>>> {
  const abbr=translationId(translation);position(book);
  const key=`${abbr}/${book}`,url=`${API_ROOT}/${key}/chapters.json`;
  const full=await savedTranslation(abbr),fromFull=full && chaptersFromTranslation(full.data,book);
  if (full && fromFull) {
    refreshDownloaded(abbr,full);
    return {data:fromFull,cached:true,verified:fullTrusted(metadata(),abbr,full),persisted:full.persisted};
  }
  const saved=await read<Record<string,ChapterInfo>>(url);
  if (saved) {
    const current=fresh(metadata().chapters[key]?.checkedAt ?? saved.savedAt);
    if (!current) background(url,()=>refreshChapters(abbr,book));
    return cached(saved,current);
  }
  return refreshChapters(abbr,book);
}

function refreshChapter(abbr:string,book:number,nr:number,saved:Saved<Chapter>|null):Promise<Result<Chapter>> {
  const key=`${abbr}/${book}/${nr}`,url=`${API_ROOT}/${key}.json`;
  return run(url,async(signal)=>{
    const sha=await sourceHash(`${API_ROOT}/${key}.sha`,signal);
    if (saved?.persisted && saved.sha===sha && metadata().loaded[key]===sha) {
      const persisted=await revalidated(url,saved,signal);
      if(persisted) {
        const next=metadata();next.loadedChecked[key]=Date.now();save(next);
        return {data:saved.data,cached:true,verified:true,persisted};
      }
    }
    const {data,bytes,verified}=await verifiedDocument<Chapter>(url,sha,30_000,signal);
    if (data.abbreviation!==abbr || data.book_nr!==book || data.chapter!==nr || !Array.isArray(data.verses)) throw new Error("GetBible returned an invalid chapter document");
    const persisted=await write(url,data,bytes,signal,verified?sha:""),next=metadata();
    if (verified) next.loaded[key]=sha;
    next.loadedChecked[key]=Date.now();save(next);
    return {data,cached:false,verified,persisted};
  });
}

export async function chapter(translation:string,book:number,nr:number):Promise<Result<Chapter>> {
  const abbr=translationId(translation);position(book);position(nr);
  const key=`${abbr}/${book}/${nr}`,url=`${API_ROOT}/${key}.json`;
  const full=await savedTranslation(abbr),fromFull=full && chapterFromTranslation(full.data,book,nr);
  if (full && fromFull) {
    refreshDownloaded(abbr,full);
    return {data:fromFull,cached:true,verified:fullTrusted(metadata(),abbr,full),persisted:full.persisted};
  }
  const saved=await read<Chapter>(url);
  if (saved) {
    const meta=metadata(),current=fresh(meta.loadedChecked[key] ?? saved.savedAt) && (!meta.loaded[key] || saved.sha===meta.loaded[key]);
    if (!current) background(url,()=>refreshChapter(abbr,book,nr,saved));
    return cached(saved,current && validSha(meta.loaded[key] || ""));
  }
  return refreshChapter(abbr,book,nr,null);
}

function refreshFullTranslation(abbr:string,saved:Saved<WholeTranslation>|null):Promise<Result<WholeTranslation>> {
  const url=`${API_ROOT}/${abbr}.json`;
  return run(url,async(signal)=>{
    // The resource's own hash is authoritative when catalogue data is older.
    const sha=await sourceHash(`${API_ROOT}/${abbr}.sha`,signal);
    if (saved?.persisted && saved.sha===sha && metadata().full[abbr]===sha) {
      const persisted=await revalidated(url,saved,signal);
      if(persisted) {
        const next=metadata();next.fullChecked[abbr]=Date.now();next.translations.hashes[abbr]=sha;save(next);
        return {data:saved.data,cached:true,verified:true,persisted};
      }
    }
    const {data,bytes,verified}=await verifiedDocument<WholeTranslation>(url,sha,180_000,signal);
    if (data.abbreviation!==abbr || !Array.isArray(data.books)) throw new Error("GetBible returned an invalid translation document");
    const persisted=await write(url,data,bytes,signal,verified?sha:""),next=metadata();
    next.downloaded[abbr]=translationFromDownload(data,sha);
    if (verified) next.full[abbr]=sha;
    next.fullChecked[abbr]=Date.now();
    next.translations.hashes[abbr]=sha;
    if (next.books[abbr]) next.books[abbr].checkedAt=0;
    for (const [key,value] of Object.entries(next.chapters)) if (key.startsWith(`${abbr}/`)) value.checkedAt=0;
    save(next);
    return {data,cached:false,verified,persisted};
  });
}

/** Download one complete source file. Ordinary reads always prefer this copy. */
export async function fullTranslation(translation:string,expectedSha:string,options:{force?:boolean;signal?:AbortSignal}={}):Promise<Result<WholeTranslation>> {
  options.signal?.throwIfAborted();
  const abbr=translationId(translation),saved=await savedTranslation(abbr),url=`${API_ROOT}/${abbr}.json`;
  if(saved?.persisted && !await fullTranslationAvailable(abbr)) saved.persisted=false;
  options.signal?.throwIfAborted();
  if (!options.force && saved && (saved.persisted || offline())) {
    const current=fullTrusted(metadata(),abbr,saved);
    if (validSha(expectedSha) && metadata().full[abbr]!==expectedSha.toLowerCase()) background(url,()=>refreshFullTranslation(abbr,saved));
    else refreshDownloaded(abbr,saved);
    return cached(saved,current);
  }
  const abort=()=>pending.get(url)?.controller.abort();
  options.signal?.addEventListener("abort",abort,{once:true});
  try { return await refreshFullTranslation(abbr,saved); }
  catch(error) {options.signal?.throwIfAborted();if(saved && !options.force) return cached(saved);throw error;}
  finally {options.signal?.removeEventListener("abort",abort);}
}

export async function fullTranslationAvailable(translation:string):Promise<boolean> {
  const abbr=translationId(translation);
  try {return !!(await (await caches.open(CACHE)).match(`${API_ROOT}/${abbr}.json`));}
  catch {return false;}
}

/** Inspect actual persisted corpora so evicted or session-only downloads are not listed. */
export async function getDownloadedTranslations():Promise<DownloadedTranslation[]> {
  const result:DownloadedTranslation[]=[],meta=metadata();
  try {
    const cache=await caches.open(CACHE);
    for (const request of await cache.keys()) {
      const match=request.url.startsWith(`${API_ROOT}/`) && request.url.slice(API_ROOT.length+1).match(/^([a-z0-9][a-z0-9_-]{0,29})\.json$/);
      if (!match || match[1]==="translations") continue;
      const abbreviation=match[1],response=await cache.match(request);
      if (!response) continue;
      let name=meta.downloaded[abbreviation]?.translation;
      if (!name) {
        const data=await response.clone().json() as WholeTranslation;
        if (!Array.isArray(data.books) || data.abbreviation!==abbreviation) continue;
        name=data.translation;
      }
      result.push({abbreviation,name,savedAt:Number(response.headers.get(CACHED_AT)) || meta.fullChecked[abbreviation] || 0,
        bytes:Number(response.headers.get(CACHE_BYTES)) || (await response.arrayBuffer()).byteLength,refreshing:pending.has(request.url)});
    }
  } catch { /* Download management remains available if storage is denied. */ }
  return result.sort((a,b)=>a.name.localeCompare(b.name));
}

async function stopRequests(matches:(url:string)=>boolean):Promise<void> {
  const requests=[...pending].filter(([url])=>matches(url));
  for (const [,request] of requests) request.controller.abort();
  // A write already in progress must finish before deletion, otherwise it could
  // restore a cache entry after the user explicitly removed it.
  await Promise.allSettled(requests.map(([,request])=>request.result));
  for (const url of failedRefreshes.keys()) if(matches(url)) failedRefreshes.delete(url);
}

/** Remove this translation's Bible data only; notes and bookmarks are independent. */
export async function removeDownloadedTranslation(translation:string):Promise<void> {
  const abbr=translationId(translation),root=`${API_ROOT}/${abbr}`;
  const matches=(url:string)=>url===`${root}.json` || url.startsWith(`${root}/`);
  await stopRequests(matches);
  for(const url of memory.keys()) if(matches(url)) memory.delete(url);
  try {
    const cache=await caches.open(CACHE);
    for(const request of await cache.keys()) if(matches(request.url)) await cache.delete(request);
  } catch { /* Memory cleanup still works if storage is denied. */ }
  const next=metadata();delete next.full[abbr];delete next.fullChecked[abbr];delete next.downloaded[abbr];delete next.books[abbr];
  for(const key of Object.keys(next.chapters)) if(key.startsWith(`${abbr}/`)) delete next.chapters[key];
  for(const key of Object.keys(next.loaded)) if(key.startsWith(`${abbr}/`)) delete next.loaded[key];
  for(const key of Object.keys(next.loadedChecked)) if(key.startsWith(`${abbr}/`)) delete next.loadedChecked[key];
  save(next);
}

export async function clearCache():Promise<void> {
  await stopRequests(()=>true);
  memory.clear();memoryMetadata=blank();
  try { localStorage.removeItem(META); } catch { /* Storage may be disabled. */ }
  try { await caches.delete(CACHE); } catch { /* No persistent cache is available. */ }
}
