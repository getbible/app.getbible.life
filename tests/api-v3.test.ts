import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { API_ROOT } from "../lib/getbible.ts";
import type { Chapter, WholeTranslation } from "../lib/getbible.ts";
import { books, chapter, chapters, clearCache, fullTranslation, fullTranslationAvailable, translations } from "../lib/cache.ts";
import { clearQueryCache, coordinateReference, normalizeScriptureReference, queryScripture, searchScripture, ScriptureApiError } from "../lib/scripture-api.ts";

const verse = {
  chapter:3,verse:16,name:"John 3:16",text:"For God  so loved the world.\n",
  tokens:[{token:"the world",word_start:5,word_end:6,lemma:{strong:["G3588","G2889"]}}],
  spans:[{tag:"q",span:"For God  so loved the world.",token_start:0,token_end:0,word_start:1,word_end:6,attrs:{who:"Jesus"}}],
};
const passage:Chapter = {
  translation:"King James Version",abbreviation:"kjv",lang:"en",language:"English",direction:"LTR",encoding:"UTF-8",
  book_nr:43,book_name:"John",chapter:3,name:"John 3",verses:[verse],
  editorial:[{order:0,type:"heading",anchor:{verse:16,edge:"before"},text:"The love of God",heading_type:"section",canonical:false}],
};
const complete:WholeTranslation = {
  translation:passage.translation,abbreviation:"kjv",lang:"en",language:"English",direction:"LTR",encoding:"UTF-8",
  books:[{nr:43,name:"John",chapters:[{chapter:3,name:"John 3",verses:[verse],editorial:passage.editorial,introduction:[{text:"Source introduction"}]}]},
    {nr:1_000_001,name:"Additional book",chapters:[{chapter:1,name:"Additional book 1",verses:[{chapter:1,verse:1,name:"Additional book 1:1",text:"Source text"}]}]}],
};
const options = {words:"all",match:"exact",caseSensitive:false,scope:"all"} as const;
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
const source=JSON.stringify(complete,null,2)+"\n";
const sha=createHash("sha1").update(source).digest("hex");

async function environment(t:{after:(fn:()=>void|Promise<void>)=>void},handler:(url:string,init?:RequestInit)=>Promise<Response>|Response) {
  const originalFetch=globalThis.fetch;
  const previousCache=Object.getOwnPropertyDescriptor(globalThis,"caches");
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  const items=new Map<string,string>();
  const responses=new Map<string,Response>();
  const cacheDeletes:string[]=[];
  const calls:string[]=[];
  const storage={
    getItem:(key:string)=>items.get(key) ?? null,
    setItem:(key:string,value:string)=>{items.set(key,value);},
    removeItem:(key:string)=>{items.delete(key);},
    clear:()=>items.clear(),key:(index:number)=>[...items.keys()][index] ?? null,get length(){return items.size;},
  };
  const cacheStorage={
    open:async()=>({match:async(key:string)=>responses.get(key)?.clone(),put:async(key:string,response:Response)=>{responses.set(key,response.clone());}}),
    delete:async(name:string)=>{cacheDeletes.push(name);responses.clear();return true;},
  };
  Object.defineProperty(globalThis,"localStorage",{value:storage,writable:true,configurable:true});
  Object.defineProperty(globalThis,"caches",{value:cacheStorage,writable:true,configurable:true});
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);calls.push(url);return handler(url,init);}) as typeof fetch;
  await clearCache();await clearQueryCache();calls.length=0;cacheDeletes.length=0;
  t.after(async()=>{
    await clearCache();await clearQueryCache();globalThis.fetch=originalFetch;
    if (previousCache) Object.defineProperty(globalThis,"caches",previousCache);else Reflect.deleteProperty(globalThis,"caches");
    if (previousStorage) Object.defineProperty(globalThis,"localStorage",previousStorage);else Reflect.deleteProperty(globalThis,"localStorage");
  });
  return {calls,items,responses,cacheDeletes,storage,cacheStorage};
}

test("server search maps filters and follows match ordering rather than verse array positions",async(t)=>{
  const chapterData={...passage,verses:[{...verse,verse:19,text:"Second ranked result"},{...verse,verse:16,text:"First ranked result"}]};
  const env=await environment(t,()=>json({
    query:{kind:"search",total:80,returned:2,offset:25,limit:25,has_more:true,sha,engine_version:5},
    results:{kjv_43_3:chapterData},matches:[{reference:"John 3:16",book_nr:43,chapter:3,verse:16,score:8},{reference:"John 3:19",book_nr:43,chapter:3,verse:19,score:2}],
  }));
  const result=await searchScripture("KJV","faith & hope",{...options,scope:"nt",sort:"relevance",books:[43,"1 John"],exclude:["darkness","death"],proximity:5},25);
  const url=new URL(env.calls[0]);
  assert.equal(url.origin,"https://search.getbible.net");assert.equal(url.pathname,"/v3/kjv");
  assert.equal(url.searchParams.get("q"),"faith & hope");assert.equal(url.searchParams.get("match"),"whole_word");
  assert.equal(url.searchParams.get("scope"),"new_testament");assert.equal(url.searchParams.get("case_sensitive"),"false");
  assert.deepEqual(url.searchParams.getAll("book"),["43","1 John"]);assert.deepEqual(url.searchParams.getAll("exclude"),["darkness","death"]);
  assert.equal(url.searchParams.get("proximity"),"5");assert.equal(url.searchParams.get("offset"),"25");
  assert.deepEqual(result.results.map(item=>item.text),["First ranked result","Second ranked result"]);
  assert.deepEqual(result.results[0].verseData.tokens,verse.tokens);
  assert.equal(result.nextCursor,27);assert.equal(result.total,80);assert.equal(result.complete,false);assert.equal(result.sha,sha);
});

test("reference-kind search has no full-text pagination or scoring fields",async(t)=>{
  await environment(t,()=>json({query:{kind:"reference",total:1,returned:1},results:{kjv_43_3:passage},matches:[{reference:"John 3:16",book_nr:43,chapter:3,verse:16}]}));
  const result=await searchScripture("kjv","John3:16",options,20);
  assert.equal(result.complete,true);assert.equal(result.kind,"reference");assert.equal(result.nextCursor,1);assert.equal(result.sha,undefined);
  assert.equal(result.results[0].score,undefined);
});

test("phrase and any-word searches omit unsupported proximity filters",async(t)=>{
  const env=await environment(t,()=>json({query:{kind:"search",total:0,returned:0,has_more:false},results:{},matches:[]}));
  await searchScripture("kjv","eternal life",{...options,words:"phrase",proximity:0});
  await searchScripture("kjv","faith hope",{...options,words:"any",proximity:0});
  assert.ok(env.calls.every(url=>!new URL(url).searchParams.has("proximity")));
});

test("query encodes chained references once and preserves v3 metadata",async(t)=>{
  const env=await environment(t,()=>json({kjv_43_3:passage}));
  const result=await queryScripture("KJV","Genesis 1:1-3;John 3:16");
  assert.equal(env.calls[0],"https://query.getbible.net/v3/kjv/Genesis%201%3A1-3%3BJohn%203%3A16");
  assert.equal(result[0].verses[0].text,verse.text);assert.deepEqual(result[0].verses[0].tokens,verse.tokens);
  assert.equal(coordinateReference(43,3,16),"43 3:16");assert.equal(coordinateReference(43,3,16,18),"43 3:16-18");
  assert.equal(coordinateReference(1_000_001,2),"1000001 2");assert.throws(()=>coordinateReference(43,3,18,16));
});

test("source OSIS references normalize aliases, ranges and chains without changing human references",async(t)=>{
  const env=await environment(t,()=>json({kjv_43_3:passage}));
  assert.equal(normalizeScriptureReference("John.3.16-John.3.18 1Cor.13.13"),"43 3:16-18;46 13:13");
  assert.equal(normalizeScriptureReference("Gen.1.1;Ps.23"),"1 1:1;19 23");
  assert.equal(normalizeScriptureReference("John.3.16-18"),"43 3:16-18");
  assert.equal(normalizeScriptureReference("John 3:16;Romans 8:1"),"John 3:16;Romans 8:1");
  await queryScripture("kjv","John.3.16-John.3.18");
  assert.equal(env.calls[0],"https://query.getbible.net/v3/kjv/43%203%3A16-18");
  assert.throws(()=>normalizeScriptureReference("John.3.16-John.4.2"),(error:unknown)=>error instanceof ScriptureApiError && error.code==="unsupported_reference");
});

test("cached query passages cover network failures and server outages but never replace API errors or cancellations",async(t)=>{
  let state:"online"|"offline"|"server"|"missing"|"limited"="online";
  await environment(t,()=>{
    if (state==="offline") throw new Error("Offline");
    if (state==="server") return json({detail:"Service unavailable",code:"busy"},503);
    if (state==="missing") return json({detail:"Reference unavailable",code:"reference_not_found"},404);
    if (state==="limited") return json({detail:"Rate limited",code:"rate_limited"},429);
    return json({kjv_43_3:passage});
  });
  await queryScripture("kjv","John3:16");
  state="offline";assert.deepEqual(await queryScripture("kjv","John3:16"),[passage]);
  state="server";assert.deepEqual(await queryScripture("kjv","John3:16"),[passage]);
  state="missing";await assert.rejects(queryScripture("kjv","John3:16"),(error:unknown)=>error instanceof ScriptureApiError && error.status===404);
  state="limited";await assert.rejects(queryScripture("kjv","John3:16"),(error:unknown)=>error instanceof ScriptureApiError && error.status===429);
  const controller=new AbortController();controller.abort();
  await assert.rejects(queryScripture("kjv","John3:16",controller.signal),{name:"AbortError"});
});

test("API problem responses expose status and retry interval without fallback passages",async(t)=>{
  await environment(t,()=>new Response(JSON.stringify({code:"rate_limited",detail:"Please wait before requesting Scripture"}),{status:429,headers:{"Retry-After":"12"}}));
  await assert.rejects(queryScripture("kjv","John3:16"),(error:unknown)=>{
    assert.ok(error instanceof ScriptureApiError);assert.equal(error.status,429);assert.equal(error.code,"rate_limited");assert.equal(error.retryAfter,12);return true;
  });
});

test("caller cancellation aborts the request and retains AbortError semantics",async(t)=>{
  await environment(t,(_url,init)=>new Promise<Response>((_resolve,reject)=>{
    init?.signal?.addEventListener("abort",()=>{const error=new Error("aborted");error.name="AbortError";reject(error);},{once:true});
  }));
  const controller=new AbortController();const request=queryScripture("kjv","John3:16",controller.signal);controller.abort();
  await assert.rejects(request,{name:"AbortError"});
});

test("one full translation download serves offline chapters and indexes with editorial metadata",async(t)=>{
  const env=await environment(t,(url)=>url.endsWith(".sha")?new Response(sha+"\n"):new Response(source));
  assert.equal(API_ROOT,"https://api.getbible.net/v3");
  const download=await fullTranslation("kjv",sha);
  assert.equal(download.verified,true);assert.equal(download.persisted,true);assert.equal(await fullTranslationAvailable("kjv"),true);
  const reading=await chapter("kjv",43,3);
  assert.deepEqual(reading.data.verses[0].tokens,verse.tokens);assert.equal(reading.data.verses[0].text,verse.text);
  assert.deepEqual(reading.data.editorial,passage.editorial);assert.deepEqual(reading.data.introduction,[{text:"Source introduction"}]);
  assert.equal(reading.data.book_name,"John");assert.equal(reading.data.lang,"en");
  assert.equal((await books("kjv")).data["1000001"].nr,1_000_001);
  assert.equal((await chapters("kjv",43)).data["3"].chapter,3);
  assert.deepEqual(env.calls,[`${API_ROOT}/kjv.sha`,`${API_ROOT}/kjv.json`]);
  // Force stale verification, then demonstrate that failed network checks retain offline reading.
  const meta=JSON.parse(env.items.get("getbible-reader:meta:api-v3")!);meta.fullChecked.kjv=0;
  env.items.set("getbible-reader:meta:api-v3",JSON.stringify(meta));
  globalThis.fetch=async()=>{throw new Error("Offline");};
  const offline=await chapter("kjv",43,3);assert.equal(offline.cached,true);assert.equal(offline.verified,false);assert.deepEqual(offline.data.editorial,passage.editorial);
});

test("exact source-byte hash mismatch does not install an unverified translation",async(t)=>{
  await environment(t,(url)=>url.endsWith(".sha")?new Response("0".repeat(40)):new Response(source));
  await assert.rejects(fullTranslation("kjv","0".repeat(40)),/changed during download/);
  assert.equal(await fullTranslationAvailable("kjv"),false);
});

test("CacheStorage and localStorage failures do not turn successful Scripture reads into errors",async(t)=>{
  const bytes=JSON.stringify(passage),chapterSha=createHash("sha1").update(bytes).digest("hex");
  const env=await environment(t,(url)=>url.endsWith(".sha")?new Response(chapterSha):new Response(bytes));
  env.storage.getItem=()=>{throw new Error("Storage disabled");};env.storage.setItem=()=>{throw new Error("Quota exhausted");};
  env.cacheStorage.open=async()=>{throw new Error("CacheStorage disabled");};
  const result=await chapter("kjv",43,3);
  assert.equal(result.verified,true);assert.equal(result.persisted,false);assert.equal(result.data.verses[0].text,verse.text);
});

test("a session-only full download is not reported as saved for offline use",async(t)=>{
  const env=await environment(t,(url)=>url.endsWith(".sha")?new Response(sha):new Response(source));
  env.cacheStorage.open=async()=>{throw new Error("Storage quota exhausted");};
  const result=await fullTranslation("kjv",sha);
  assert.equal(result.verified,true);assert.equal(result.persisted,false);
  assert.equal(await fullTranslationAvailable("kjv"),false);
  assert.equal((await chapter("kjv",43,3)).data.verses[0].text,verse.text);
});

test("clearing v3 API data keeps personal data and the separate legacy cache namespace",async(t)=>{
  const env=await environment(t,()=>json({}));
  env.items.set("getbible-reader:notes:v1","personal notes");env.items.set("getbible-reader:meta:v1","v2 cache metadata");
  await clearCache();
  assert.equal(env.items.get("getbible-reader:notes:v1"),"personal notes");assert.equal(env.items.get("getbible-reader:meta:v1"),"v2 cache metadata");
  assert.deepEqual(env.cacheDeletes,["getbible-reader-api-v3"]);
});

test("changed translation and book hashes refresh child navigation indexes without discarding offline bodies",async(t)=>{
  let revision=1,offline=false;
  const succeeded:string[]=[];
  const digest=(value:number)=>String(value).repeat(40);
  const env=await environment(t,(url)=>{
    if (offline) throw new Error("Offline");
    succeeded.push(url);
    if (url.endsWith("/translations.json")) return json({kjv:{translation:"King James Version",abbreviation:"kjv",lang:"en",language:"English",direction:"LTR",sha:digest(revision)}});
    if (url.endsWith("/books.json")) return json({43:{nr:43,name:"John",direction:"LTR",sha:digest(revision)},45:{nr:45,name:"Romans",direction:"LTR",sha:digest(9)}});
    if (url.endsWith("/43/chapters.json")) return json(Object.fromEntries(Array.from({length:revision},(_,index)=>[String(index+1),{chapter:index+1,name:`John ${index+1}`,sha:digest(index+1)}])));
    if (url.endsWith("/45/chapters.json")) return json({1:{chapter:1,name:"Romans 1",sha:digest(9)}});
    throw new Error(`Unexpected request ${url}`);
  });
  await translations();await books("kjv");await chapters("kjv",43);await chapters("kjv",45);
  const expire=(change:(meta:Record<string,unknown>)=>void)=>{
    const meta=JSON.parse(env.items.get("getbible-reader:meta:api-v3")!);change(meta);
    env.items.set("getbible-reader:meta:api-v3",JSON.stringify(meta));
  };
  expire((meta)=>{(meta.translations as {checkedAt:number}).checkedAt=0;});
  revision=2;await translations();
  // The successful parent refresh forces child refresh, but an offline failure keeps their saved bodies.
  offline=true;
  const offlineBooks=await books("kjv"),offlineChapters=await chapters("kjv",43);
  assert.equal(offlineBooks.cached,true);assert.equal(offlineBooks.verified,false);
  assert.deepEqual(Object.keys(offlineChapters.data),["1"]);assert.equal(offlineChapters.verified,false);
  offline=false;
  await books("kjv");assert.deepEqual(Object.keys((await chapters("kjv",43)).data),["1","2"]);await chapters("kjv",45);
  // A later book-only hash change expires John's chapter index while Romans stays fresh.
  expire((meta)=>{(meta.books as Record<string,{checkedAt:number}>).kjv.checkedAt=0;meta.loaded={"kjv/43/1":digest(1),"kjv/45/1":digest(9)};});
  revision=3;await books("kjv");
  const verification=JSON.parse(env.items.get("getbible-reader:meta:api-v3")!);
  assert.equal(verification.loaded["kjv/43/1"],undefined);assert.equal(verification.loaded["kjv/45/1"],digest(9));
  assert.deepEqual(Object.keys((await chapters("kjv",43)).data),["1","2","3"]);await chapters("kjv",45);
  assert.equal(succeeded.filter(url=>url.endsWith("/43/chapters.json")).length,3);
  assert.equal(succeeded.filter(url=>url.endsWith("/45/chapters.json")).length,2);
});
