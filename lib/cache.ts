import { API_ROOT, Book, Chapter, ChapterInfo, Translation, WholeTranslation, fresh, validSha } from "./getbible";

const CACHE = "getbible-reader-v1";
const META = "getbible-reader:meta:v1";
type HashSet = { checkedAt:number; hashes:Record<string,string> };
type Metadata = { version:1; translations:HashSet; books:Record<string,HashSet>; chapters:Record<string,HashSet>; loaded:Record<string,string>; full:Record<string,string> };
export type Result<T> = { data:T; cached:boolean; verified:boolean };

const blank = ():Metadata => ({version:1,translations:{checkedAt:0,hashes:{}},books:{},chapters:{},loaded:{},full:{}});
const metadata = ():Metadata => {
  try { const data=JSON.parse(localStorage.getItem(META) || "null") as Metadata|null; return data?.version===1?{...data,full:data.full||{}}:blank(); }
  catch { return blank(); }
};
const save = (data:Metadata) => localStorage.setItem(META,JSON.stringify(data));
const cache = () => caches.open(CACHE);
const read = async <T>(url:string):Promise<T|null> => { const response=await (await cache()).match(url); return response ? response.json() as Promise<T> : null; };
const write = async <T>(url:string,data:T) => (await cache()).put(url,new Response(JSON.stringify(data),{headers:{"content-type":"application/json"}}));
const network = async <T>(url:string):Promise<T> => { const response=await fetch(url,{cache:"no-store",headers:{accept:"application/json"}}); if(!response.ok) throw new Error(`GetBible returned HTTP ${response.status}`); return response.json() as Promise<T>; };
const hashes = <T extends {sha:string}>(record:Record<string,T>) => Object.fromEntries(Object.entries(record).map(([key,value])=>[key,value.sha]));

async function purge(prefix:string):Promise<void> {
  const store=await cache();
  const requests=await store.keys();
  await Promise.all(requests.filter(request=>request.url.startsWith(prefix)).map(request=>store.delete(request)));
}

export async function translations():Promise<Result<Record<string,Translation>>> {
  const url=`${API_ROOT}/translations.json`, meta=metadata(), saved=await read<Record<string,Translation>>(url);
  if(saved && fresh(meta.translations.checkedAt)) return {data:saved,cached:true,verified:true};
  try {
    const data=await network<Record<string,Translation>>(url), next=hashes(data);
    for(const [abbr,sha] of Object.entries(meta.translations.hashes)) if(next[abbr]!==sha) {
      await purge(`${API_ROOT}/${abbr}/`);
      await (await cache()).delete(`${API_ROOT}/${abbr}.json`);
      delete meta.full[abbr];
    }
    meta.translations={checkedAt:Date.now(),hashes:next}; save(meta); await write(url,data); return {data,cached:false,verified:true};
  } catch(error) { if(saved) return {data:saved,cached:true,verified:false}; throw error; }
}

export async function books(abbr:string):Promise<Result<Record<string,Book>>> {
  const url=`${API_ROOT}/${abbr}/books.json`, meta=metadata(), saved=await read<Record<string,Book>>(url);
  if(saved && fresh(meta.books[abbr]?.checkedAt||0)) return {data:saved,cached:true,verified:true};
  try {
    const data=await network<Record<string,Book>>(url), next=hashes(data), old=meta.books[abbr]?.hashes||{};
    for(const [book,sha] of Object.entries(old)) if(next[book]!==sha) await purge(`${API_ROOT}/${abbr}/${book}/`);
    meta.books[abbr]={checkedAt:Date.now(),hashes:next}; save(meta); await write(url,data); return {data,cached:false,verified:true};
  } catch(error) { if(saved) return {data:saved,cached:true,verified:false}; throw error; }
}

export async function chapters(abbr:string,book:number):Promise<Result<Record<string,ChapterInfo>>> {
  const key=`${abbr}/${book}`, url=`${API_ROOT}/${key}/chapters.json`, meta=metadata(), saved=await read<Record<string,ChapterInfo>>(url);
  if(saved && fresh(meta.chapters[key]?.checkedAt||0)) return {data:saved,cached:true,verified:true};
  try {
    const data=await network<Record<string,ChapterInfo>>(url), next=hashes(data), old=meta.chapters[key]?.hashes||{};
    for(const [chapter,sha] of Object.entries(old)) if(next[chapter]!==sha) await (await cache()).delete(`${API_ROOT}/${key}/${chapter}.json`);
    meta.chapters[key]={checkedAt:Date.now(),hashes:next}; save(meta); await write(url,data); return {data,cached:false,verified:true};
  } catch(error) { if(saved) return {data:saved,cached:true,verified:false}; throw error; }
}

export async function chapter(abbr:string,book:number,nr:number):Promise<Result<Chapter>> {
  const key=`${abbr}/${book}/${nr}`, url=`${API_ROOT}/${key}.json`, saved=await read<Chapter>(url);
  try {
    const response=await fetch(`${API_ROOT}/${key}.sha`,{cache:"no-store"});
    if(!response.ok) throw new Error(`Hash returned HTTP ${response.status}`);
    const sha=(await response.text()).trim(); if(!validSha(sha)) throw new Error("Invalid chapter hash");
    const meta=metadata(); if(saved && meta.loaded[key]===sha) return {data:saved,cached:true,verified:true};
    const data=await network<Chapter>(url); await write(url,data); meta.loaded[key]=sha; save(meta); return {data,cached:false,verified:true};
  } catch(error) { if(saved) return {data:saved,cached:true,verified:false}; throw error; }
}

export async function fullTranslation(abbr:string,sha:string):Promise<Result<WholeTranslation>> {
  const url=`${API_ROOT}/${abbr}.json`, meta=metadata(), saved=await read<WholeTranslation>(url);
  if(saved && validSha(sha) && meta.full[abbr]===sha) return {data:saved,cached:true,verified:true};
  try {
    const data=await network<WholeTranslation>(url);
    await write(url,data);
    meta.full[abbr]=sha;
    save(meta);
    return {data,cached:false,verified:true};
  } catch(error) { if(saved) return {data:saved,cached:true,verified:false}; throw error; }
}

export async function clearCache():Promise<void> { localStorage.removeItem(META); await caches.delete(CACHE); }
