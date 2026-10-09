import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { API_ROOT } from "../lib/getbible.ts";
import type { Chapter, WholeTranslation } from "../lib/getbible.ts";
import * as reader from "../lib/cache.ts";
import { CACHE_MAX_AGE_MS } from "../lib/cache-policy.ts";

const CACHE="getbible-reader-api-v3",META="getbible-reader:meta:api-v3";
const verse={chapter:3,verse:16,name:"John 3:16",text:"For God so loved the world."};
const chapter:Chapter={translation:"King James Version",abbreviation:"kjv",lang:"en",language:"English",direction:"LTR",book_nr:43,book_name:"John",chapter:3,name:"John 3",verses:[verse]};
const corpus:WholeTranslation={translation:chapter.translation,abbreviation:"kjv",lang:"en",language:"English",direction:"LTR",books:[{nr:43,name:"John",chapters:[{chapter:3,name:"John 3",verses:[verse]}]}]};
const body=JSON.stringify(corpus),sha=createHash("sha1").update(body).digest("hex");
const digest=(value:number)=>String(value).repeat(40);
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}});

async function eventually(check:()=>boolean|Promise<boolean>):Promise<void> {
  for(let i=0;i<100;i++) {if(await check()) return;await new Promise<void>(resolve=>setImmediate(resolve));}
  assert.fail("Background cache operation did not finish");
}
async function immediate<T>(work:Promise<T>):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {return await Promise.race([work,new Promise<T>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error("Cached reading waited for the network")),100);})]);}
  finally {clearTimeout(timer);}
}
async function browser(t:{after:(fn:()=>void|Promise<void>)=>void},handler:(url:string,init?:RequestInit)=>Promise<Response>|Response) {
  const descriptors=new Map(["fetch","navigator","localStorage","caches"].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const items=new Map<string,string>(),stores=new Map<string,Map<string,Response>>(),calls:string[]=[];
  let denyWrites=false;
  const key=(value:Request|string)=>typeof value==="string"?value:value.url;
  const storage={getItem:(key:string)=>items.get(key) ?? null,setItem:(key:string,value:string)=>items.set(key,value),removeItem:(key:string)=>items.delete(key)};
  const caches={
    async open(name:string) {
      let store=stores.get(name);if(!store) {store=new Map();stores.set(name,store);}
      return {match:async(request:Request|string)=>store!.get(key(request))?.clone(),put:async(request:Request|string,response:Response)=>{if(denyWrites) throw new Error("Quota exceeded");store!.set(key(request),response.clone());},delete:async(request:Request|string)=>store!.delete(key(request)),keys:async()=>[...store!.keys()].map(url=>new Request(url))};
    },delete:async(name:string)=>stores.delete(name),keys:async()=>[...stores.keys()],
  };
  Object.defineProperties(globalThis,{
    navigator:{value:{onLine:true},configurable:true},localStorage:{value:storage,configurable:true},caches:{value:caches,configurable:true},
    fetch:{value:(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);calls.push(url);return handler(url,init);}) as typeof fetch,configurable:true,writable:true},
  });
  await reader.clearCache();
  t.after(async()=>{
    await reader.clearCache();
    for(const [key,value] of descriptors) {if(value) Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}
  });
  return {items,stores,calls,caches,denyWrites(value=true){denyWrites=value;},offline(value=true){Object.defineProperty(globalThis,"navigator",{value:{onLine:!value},configurable:true});},expire(change:(meta:Record<string,unknown>)=>void){const meta=JSON.parse(items.get(META)!);change(meta);items.set(META,JSON.stringify(meta));}};
}
function stalled(init?:RequestInit):Promise<Response> {
  return new Promise((_resolve,reject)=>{init?.signal?.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});});
}

test("a cold downloaded reader starts immediately with a stalled connection or no connection",async(t)=>{
  let block=false;
  const env=await browser(t,(url,init)=>block?stalled(init):new Response(url.endsWith(".sha")?sha:body));
  await reader.fullTranslation("kjv",sha);
  env.items.clear();block=true;
  const url=new URL("../lib/cache.ts",import.meta.url);url.searchParams.set("cold",String(Date.now()));
  const cold=await import(url.href) as typeof reader;
  t.after(()=>cold.clearCache());
  // The navigator reports online, but its requests never complete.
  const catalogue=await immediate(cold.translations());
  assert.equal(catalogue.data.kjv.translation,chapter.translation);
  assert.deepEqual((await immediate(cold.chapter("kjv",43,3))).data.verses,[verse]);
  env.offline();
  assert.equal((await immediate(cold.books("kjv"))).data["43"].name,"John");
  assert.equal((await immediate(cold.chapters("kjv",43))).data["3"].chapter,3);
  assert.equal(await cold.fullTranslationAvailable("kjv"),true);
  await cold.clearCache();
});

test("individual chapters read from cache for thirty days and revalidate once without blocking",async(t)=>{
  let now=Date.now(),block=false,release:((value:Response)=>void)|undefined;
  t.mock.method(Date,"now",()=>now);
  const chapterBody=JSON.stringify(chapter),chapterSha=createHash("sha1").update(chapterBody).digest("hex");
  const env=await browser(t,(url,init)=>{
    if(block) return new Promise<Response>((resolve,reject)=>{release=resolve;init?.signal?.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});});
    return new Response(url.endsWith(".sha")?chapterSha:chapterBody);
  });
  await reader.chapter("kjv",43,3);
  now+=CACHE_MAX_AGE_MS-1;
  assert.equal((await reader.chapter("kjv",43,3)).verified,true);assert.equal(env.calls.length,2);
  now+=2;block=true;
  const cached=await immediate(reader.chapter("kjv",43,3));
  assert.equal(cached.cached,true);assert.equal(cached.verified,false);assert.deepEqual(cached.data,chapter);
  await immediate(reader.chapter("kjv",43,3));assert.equal(env.calls.length,3);
  assert.ok(release);release(new Response(chapterSha));
  await eventually(()=>Number(env.stores.get(CACHE)?.get(`${API_ROOT}/kjv/43/3.json`)?.headers.get("x-getbible-cached-at"))===now);
  assert.equal((await reader.chapter("kjv",43,3)).verified,true);
  assert.equal(env.calls.filter(url=>url.endsWith(".json")).length,1);
});

test("a failed full refresh retains the previous corpus and a successful refresh replaces it atomically",async(t)=>{
  let responseBody=body,responseSha=sha;
  const env=await browser(t,url=>new Response(url.endsWith(".sha")?responseSha:responseBody));
  await reader.fullTranslation("kjv",sha);
  const initial=await reader.getDownloadedTranslations();
  assert.equal(initial.length,1);assert.equal(initial[0].bytes,new TextEncoder().encode(body).byteLength);assert.ok(initial[0].savedAt>0);
  const changed={...corpus,books:[{nr:43,name:"John",chapters:[{chapter:3,name:"John 3",verses:[{...verse,text:"Updated source text."}]}]}]};
  responseBody=JSON.stringify(changed);responseSha="0".repeat(40);
  await assert.rejects(reader.fullTranslation("kjv",sha,{force:true}),/changed during download/);
  assert.equal((await reader.chapter("kjv",43,3)).data.verses[0].text,verse.text);
  assert.equal((await reader.getDownloadedTranslations())[0].savedAt,initial[0].savedAt);
  assert.equal(await env.stores.get(CACHE)?.get(`${API_ROOT}/kjv.json`)?.clone().text(),body);
  responseSha=createHash("sha1").update(responseBody).digest("hex");
  await reader.fullTranslation("kjv",sha,{force:true});
  assert.equal((await reader.chapter("kjv",43,3)).data.verses[0].text,"Updated source text.");
});

test("hash-only revalidation preserves the exact downloaded source bytes",async(t)=>{
  const source=JSON.stringify(corpus,null,2)+"\n",hash=createHash("sha1").update(source).digest("hex");
  const env=await browser(t,url=>new Response(url.endsWith(".sha")?hash:source));
  await reader.fullTranslation("kjv",hash);await reader.fullTranslation("kjv",hash,{force:true});
  const response=env.stores.get(CACHE)!.get(`${API_ROOT}/kjv.json`)!;
  assert.equal(await response.clone().text(),source);assert.equal(response.headers.get("x-getbible-sha"),hash);
  assert.equal(env.calls.filter(url=>url.endsWith(".json")).length,1);
});

test("downloading again restores a browser-evicted corpus even when session memory is warm",async(t)=>{
  const env=await browser(t,url=>new Response(url.endsWith(".sha")?sha:body));
  await reader.fullTranslation("kjv",sha);
  env.stores.get(CACHE)!.delete(`${API_ROOT}/kjv.json`);
  assert.equal(await reader.fullTranslationAvailable("kjv"),false);
  assert.equal((await reader.fullTranslation("kjv",sha)).persisted,true);
  assert.equal(await reader.fullTranslationAvailable("kjv"),true);
});

test("removing a translation cancels its refresh and clears its memory and indexes without personal-data loss",async(t)=>{
  let block=false;
  const env=await browser(t,(url,init)=>block?stalled(init):new Response(url.endsWith(".sha")?sha:body));
  await reader.fullTranslation("kjv",sha);
  env.items.set("getbible-reader:notes:v1","my note");env.items.set("getbible-reader:bookmark-topics:v2","my bookmarks");
  const cache=await env.caches.open(CACHE);
  await cache.put(`${API_ROOT}/kjv/43/3.json`,json(chapter));await cache.put(`${API_ROOT}/aov/1/1.json`,json({other:"translation"}));
  block=true;
  env.expire(meta=>{(meta.fullChecked as Record<string,number>).kjv=0;});
  await reader.chapter("kjv",43,3);
  assert.equal((await reader.getDownloadedTranslations())[0].refreshing,true);
  await reader.removeDownloadedTranslation("kjv");
  assert.deepEqual(await reader.getDownloadedTranslations(),[]);assert.equal(await reader.fullTranslationAvailable("kjv"),false);
  assert.equal(env.stores.get(CACHE)?.has(`${API_ROOT}/kjv/43/3.json`),false);
  assert.equal(env.stores.get(CACHE)?.has(`${API_ROOT}/aov/1/1.json`),true);
  assert.equal(env.items.get("getbible-reader:notes:v1"),"my note");assert.equal(env.items.get("getbible-reader:bookmark-topics:v2"),"my bookmarks");
  env.offline();
  globalThis.fetch=async()=>{throw new Error("Offline");};
  await assert.rejects(reader.chapter("kjv",43,3),/Offline/);
});

test("quota failure during refresh never verifies an older persisted corpus against newer metadata",async(t)=>{
  let responseBody=body,responseSha=sha;
  const env=await browser(t,url=>new Response(url.endsWith(".sha")?responseSha:responseBody));
  await reader.fullTranslation("kjv",sha);
  responseBody=JSON.stringify({...corpus,books:[{nr:43,name:"John",chapters:[{chapter:3,name:"John 3",verses:[{...verse,text:"New source"}]}]}]});
  responseSha=createHash("sha1").update(responseBody).digest("hex");
  env.denyWrites();
  assert.equal((await reader.fullTranslation("kjv",sha,{force:true})).persisted,false);
  assert.equal((await reader.chapter("kjv",43,3)).data.verses[0].text,"New source");
  env.offline();
  const url=new URL("../lib/cache.ts",import.meta.url);url.searchParams.set("quota",String(Date.now()));
  const cold=await import(url.href) as typeof reader;
  const saved=await cold.chapter("kjv",43,3);
  assert.equal(saved.data.verses[0].text,verse.text);assert.equal(saved.verified,false);
  assert.equal(await cold.fullTranslationAvailable("kjv"),true);
  await cold.clearCache();
});

test("changed parent hashes expire navigation indexes while stale bodies remain immediately readable",async(t)=>{
  let revision=1;
  const env=await browser(t,url=>{
    if(url.endsWith("/translations.json")) return json({kjv:{translation:chapter.translation,abbreviation:"kjv",lang:"en",language:"English",direction:"LTR",sha:digest(revision)}});
    if(url.endsWith("/books.json")) return json({43:{nr:43,name:"John",direction:"LTR",sha:digest(revision)},45:{nr:45,name:"Romans",direction:"LTR",sha:digest(9)}});
    if(url.endsWith("/43/chapters.json")) return json(Object.fromEntries(Array.from({length:revision},(_,index)=>[String(index+1),{chapter:index+1,name:`John ${index+1}`,sha:digest(index+1)}])));
    if(url.endsWith("/45/chapters.json")) return json({1:{chapter:1,name:"Romans 1",sha:digest(9)}});
    throw new Error(`Unexpected ${url}`);
  });
  await reader.translations();await reader.books("kjv");await reader.chapters("kjv",43);await reader.chapters("kjv",45);
  revision=2;env.expire(meta=>{(meta.translations as {checkedAt:number}).checkedAt=0;});
  assert.equal((await reader.translations()).data.kjv.sha,digest(1));
  await eventually(()=>JSON.parse(env.items.get(META)!).translations.hashes.kjv===digest(2));
  env.offline();assert.equal((await reader.books("kjv")).verified,false);assert.deepEqual(Object.keys((await reader.chapters("kjv",43)).data),["1"]);
  env.offline(false);await reader.books("kjv");
  await eventually(()=>JSON.parse(env.items.get(META)!).books.kjv.hashes["43"]===digest(2));
  await reader.chapters("kjv",43);await reader.chapters("kjv",45);
  await eventually(async()=>Object.keys((await reader.chapters("kjv",43)).data).length===2);
  env.expire(meta=>{(meta.books as Record<string,{checkedAt:number}>).kjv.checkedAt=0;meta.loaded={"kjv/43/1":digest(1),"kjv/45/1":digest(9)};});
  revision=3;await reader.books("kjv");
  await eventually(()=>JSON.parse(env.items.get(META)!).books.kjv.hashes["43"]===digest(3));
  const meta=JSON.parse(env.items.get(META)!);
  assert.equal(meta.loaded["kjv/43/1"],undefined);assert.equal(meta.loaded["kjv/45/1"],digest(9));
  await reader.chapters("kjv",43);
  await eventually(async()=>Object.keys((await reader.chapters("kjv",43)).data).length===3);
  assert.equal(env.calls.filter(url=>url.endsWith("/43/chapters.json")).length,3);
  assert.equal(env.calls.filter(url=>url.endsWith("/45/chapters.json")).length,2);
});
