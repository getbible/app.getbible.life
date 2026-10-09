import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { API_ROOT } from "../lib/getbible.ts";
import type { Chapter, WholeTranslation } from "../lib/getbible.ts";
import { books, chapter, chapters, clearCache, fullTranslation, fullTranslationAvailable, translations } from "../lib/cache.ts";
import { clearQueryCache, coordinateReference, normalizeScriptureReference, queryScripture, searchScripture, ScriptureApiError } from "../lib/scripture-api.ts";
import { CACHE_MAX_AGE_MS } from "../lib/cache-policy.ts";

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
    open:async()=>({match:async(key:string)=>responses.get(key)?.clone(),put:async(key:string,response:Response)=>{responses.set(key,response.clone());},keys:async()=>[...responses.keys()].map(url=>new Request(url))}),
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
    results:{kjv_43_3:chapterData},matches:[{reference:"John 3:16",book_nr:43,chapter:3,verse:16,score:8,occurrences:3,terms:["faith","hope"]},{reference:"John 3:19",book_nr:43,chapter:3,verse:19,score:2}],
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
  assert.equal(result.results[0].occurrences,3);assert.deepEqual(result.results[0].terms,["faith","hope"]);assert.equal(result.results[0].score,8);
  assert.equal(result.nextCursor,27);assert.equal(result.total,80);assert.equal(result.complete,false);assert.equal(result.sha,sha);
});

test("reverse search starts at the true last match and pages backward without skipping or repeating verses",async(t)=>{
  const total=58;
  const env=await environment(t,(raw)=>{
    const url=new URL(raw),offset=Number(url.searchParams.get("offset")),limit=Number(url.searchParams.get("limit"));
    assert.equal(url.searchParams.get("sort"),"canonical");
    const numbers=Array.from({length:Math.min(limit,total-offset)},(_,index)=>offset+index+1);
    return json({query:{kind:"search",total,returned:numbers.length,offset,has_more:offset+numbers.length<total,sha,engine_version:5},
      results:{kjv_43_3:{...passage,verses:numbers.map(number=>({...verse,verse:number,text:`Verse ${number}`}))}},
      matches:numbers.map(number=>({book_nr:43,chapter:3,verse:number,reference:`John 3:${number}`}))});
  });
  const reverse={...options,sort:"canonical_desc" as const,limit:25};
  const first=await searchScripture("kjv","hope",reverse);
  const second=await searchScripture("kjv","hope",reverse,first.nextCursor);
  const third=await searchScripture("kjv","hope",reverse,second.nextCursor);
  assert.deepEqual([...first.results,...second.results,...third.results].map(item=>item.verse),Array.from({length:total},(_,index)=>total-index));
  assert.deepEqual(env.calls.map(raw=>[new URL(raw).searchParams.get("offset"),new URL(raw).searchParams.get("limit")]),[["0","25"],["33","25"],["8","25"],["0","8"]]);
  assert.equal(first.complete,false);assert.equal(second.complete,false);assert.equal(third.complete,true);assert.equal(third.nextCursor,total);
});

test("reverse search respects the API offset boundary and refuses inaccessible tails",async(t)=>{
  let total=10_030;
  const env=await environment(t,(raw)=>{
    const url=new URL(raw),offset=Number(url.searchParams.get("offset")),limit=Number(url.searchParams.get("limit"));
    assert.ok(offset<=10_000);assert.ok(limit<=100);
    const numbers=Array.from({length:Math.min(limit,total-offset)},(_,index)=>offset+index+1);
    return json({query:{kind:"search",total,returned:numbers.length,offset,has_more:offset+numbers.length<total,sha},
      results:{kjv_43_3:{...passage,verses:numbers.map(number=>({...verse,verse:number}))}},
      matches:numbers.map(number=>({book_nr:43,chapter:3,verse:number,reference:`John 3:${number}`}))});
  });
  const result=await searchScripture("kjv","faith",{...options,sort:"canonical_desc"});
  assert.equal(result.results[0].verse,total);assert.equal(result.results.at(-1)?.verse,total-24);
  assert.equal(new URL(env.calls[1]).searchParams.get("offset"),"10000");assert.equal(new URL(env.calls[1]).searchParams.get("limit"),"30");
  total=10_101;
  await assert.rejects(searchScripture("kjv","faith",{...options,sort:"canonical_desc"}),error=>error instanceof ScriptureApiError && error.code==="reverse_search_limit");
});

test("reverse search rejects a source change between its count and requested page",async(t)=>{
  let request=0;
  await environment(t,(raw)=>{
    const url=new URL(raw),offset=Number(url.searchParams.get("offset"));request+=1;
    return json({query:{kind:"search",total:50,returned:1,offset,has_more:true,sha:request===1?sha:"changed"},results:{kjv_43_3:passage},matches:[{book_nr:43,chapter:3,verse:16,reference:"John 3:16"}]});
  });
  await assert.rejects(searchScripture("kjv","hope",{...options,sort:"canonical_desc"}),error=>error instanceof ScriptureApiError && error.code==="search_changed");
});

test("forward search reaches every API-accessible result across the offset boundary without overlap",async(t)=>{
  const total=20_000;
  const env=await environment(t,(raw)=>{
    const url=new URL(raw),offset=Number(url.searchParams.get("offset")),limit=Number(url.searchParams.get("limit"));
    assert.ok(offset<=10_000);assert.ok(limit<=100);
    const numbers=Array.from({length:limit},(_,index)=>offset+index+1);
    return json({query:{kind:"search",total,returned:numbers.length,offset,has_more:true,sha},
      results:{kjv_43_3:{...passage,verses:numbers.map(number=>({...verse,verse:number}))}},
      matches:numbers.map(number=>({book_nr:43,chapter:3,verse:number,reference:`John 3:${number}`}))});
  });
  const first=await searchScripture("kjv","faith",options,9_990);
  const last=await searchScripture("kjv","faith",options,first.nextCursor);
  assert.deepEqual([...first.results,...last.results].map(item=>item.verse),Array.from({length:110},(_,index)=>9_991+index));
  assert.equal(first.complete,false);assert.equal(last.complete,true);assert.equal(last.nextCursor,10_100);assert.equal(last.total,total);
  assert.deepEqual(env.calls.map(raw=>new URL(raw).searchParams.get("offset")),["9990","10000"]);
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

test("query passages use a timestamped cache immediately online and offline without unnecessary network checks",async(t)=>{
  const env=await environment(t,()=>json({kjv_43_3:passage}));
  await queryScripture("kjv","John3:16");
  assert.deepEqual(await queryScripture("kjv","John3:16"),[passage]);
  assert.equal(env.calls.length,1);
  const saved=env.responses.get(env.calls[0]);assert.ok(Number(saved?.headers.get("x-getbible-cached-at"))>0);
  globalThis.fetch=async()=>{throw new Error("Offline");};
  assert.deepEqual(await queryScripture("kjv","John3:16"),[passage]);
  const controller=new AbortController();controller.abort();
  await assert.rejects(queryScripture("kjv","John3:16",controller.signal),{name:"AbortError"});
});

test("expired query passages remain readable while one background refresh replaces the saved data",async(t)=>{
  const originalNow=Date.now;let now=originalNow();Date.now=()=>now;t.after(()=>{Date.now=originalNow;});
  let finish:((response:Response)=>void)|undefined;
  const updated={...passage,name:"Updated John 3"};
  const env=await environment(t,()=>finish===undefined?json({kjv_43_3:passage}):new Promise(resolve=>{finish=resolve;}));
  await queryScripture("kjv","John3:16");
  now+=CACHE_MAX_AGE_MS;finish=()=>{};
  assert.deepEqual(await queryScripture("kjv","John3:16"),[passage]);
  assert.deepEqual(await queryScripture("kjv","John3:16"),[passage]);
  assert.equal(env.calls.length,2);
  finish!(json({kjv_43_3:updated}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(await queryScripture("kjv","John3:16"),[updated]);
  assert.equal(env.calls.length,2);
});

test("clearing query caches during a refresh does not restore removed entries",async(t)=>{
  const originalNow=Date.now;let now=originalNow();Date.now=()=>now;t.after(()=>{Date.now=originalNow;});
  let finish:((response:Response)=>void)|undefined;
  const env=await environment(t,()=>finish===undefined?json({kjv_43_3:passage}):new Promise(resolve=>{finish=resolve;}));
  await queryScripture("kjv","John3:16");now+=CACHE_MAX_AGE_MS;finish=()=>{};
  await queryScripture("kjv","John3:16");await clearQueryCache();
  finish!(json({kjv_43_3:passage}));await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(env.responses.size,0);
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

test("a downloaded translation boots without the separately cached translation catalogue",async(t)=>{
  const env=await environment(t,(url)=>url.endsWith(".sha")?new Response(sha):new Response(source));
  await fullTranslation("kjv",sha);
  const previousNavigator=Object.getOwnPropertyDescriptor(globalThis,"navigator");
  Object.defineProperty(globalThis,"navigator",{value:{onLine:false},configurable:true});
  t.after(()=>{if(previousNavigator) Object.defineProperty(globalThis,"navigator",previousNavigator);else Reflect.deleteProperty(globalThis,"navigator");});
  env.calls.length=0;
  const meta=JSON.parse(env.items.get("getbible-reader:meta:api-v3")!);meta.fullChecked.kjv=0;
  env.items.set("getbible-reader:meta:api-v3",JSON.stringify(meta));
  const catalogue=await translations();
  assert.equal(catalogue.data.kjv.translation,"King James Version");
  assert.equal(catalogue.data.kjv.sha,sha);
  assert.equal("books" in catalogue.data.kjv,false);
  assert.equal(catalogue.verified,false);
  assert.equal((await books("kjv")).data["43"].name,"John");
  assert.equal((await chapters("kjv",43)).data["3"].chapter,3);
  assert.deepEqual((await chapter("kjv",43,3)).data.editorial,passage.editorial);
  assert.deepEqual(env.calls,[]);
});

test("a cold offline reader recovers persisted corpuses after catalogue and metadata eviction",async(t)=>{
  const env=await environment(t,(url)=>url.endsWith(".sha")?new Response(sha):new Response(source));
  await fullTranslation("kjv",sha);
  env.items.clear();
  const previousNavigator=Object.getOwnPropertyDescriptor(globalThis,"navigator");
  Object.defineProperty(globalThis,"navigator",{value:{onLine:false},configurable:true});
  t.after(()=>{if(previousNavigator) Object.defineProperty(globalThis,"navigator",previousNavigator);else Reflect.deleteProperty(globalThis,"navigator");});
  env.calls.length=0;
  const coldModule=new URL("../lib/cache.ts",import.meta.url);coldModule.searchParams.set("restart",String(Date.now()));
  const cold=await import(coldModule.href) as typeof import("../lib/cache.ts");
  const catalogue=await cold.translations();
  assert.equal(catalogue.data.kjv.abbreviation,"kjv");
  assert.equal(catalogue.persisted,true);
  assert.equal(catalogue.verified,false);
  assert.equal(await cold.fullTranslationAvailable("kjv"),true);
  assert.equal((await cold.books("kjv")).data["1000001"].name,"Additional book");
  assert.equal((await cold.chapters("kjv",43)).data["3"].chapter,3);
  assert.deepEqual((await cold.chapter("kjv",43,3)).data.verses[0].tokens,verse.tokens);
  assert.deepEqual(env.calls,[]);
});

test("translation catalogue failures fall back to downloaded source metadata",async(t)=>{
  let disconnected=false;
  const env=await environment(t,(url)=>{
    if(disconnected) throw new Error("Connection lost");
    return url.endsWith(".sha")?new Response(sha):new Response(source);
  });
  await fullTranslation("kjv",sha);disconnected=true;
  const catalogue=await translations();
  assert.equal(catalogue.data.kjv.abbreviation,"kjv");
  assert.equal(catalogue.cached,true);
  assert.equal(catalogue.verified,false);
  assert.equal(env.calls.at(-1),`${API_ROOT}/translations.json`);
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
