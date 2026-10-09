import type { Chapter, Verse } from "./getbible.ts";
import type { SearchOptions, SearchVerse } from "./search.ts";
import { isCacheFresh } from "./cache-policy.ts";

export const QUERY_ROOT = "https://query.getbible.net/v3";
export const SEARCH_ROOT = "https://search.getbible.net/v3";
const QUERY_CACHE = "getbible-query-v3";
type SavedQuery = {data:Record<string,Chapter>;savedAt:number};
const queryMemory = new Map<string,SavedQuery>();
const queryRefreshes = new Map<string,Promise<void>>();
let queryGeneration=0;
export type SearchSort = "canonical"|"canonical_desc"|"relevance";
export type ServerSearchOptions = Omit<SearchOptions,"scope"> & {
  scope:SearchOptions["scope"]|"deuterocanon";
  sort?:SearchSort;
  diacritics?:"fold"|"exact";
  exclude?:string[];
  proximity?:number;
  books?:Array<string|number>;
  limit?:number;
};
export interface ServerSearchVerse extends SearchVerse {
  /** Keep the original v3 lexical and annotation data available to the reader. */
  verseData:Verse;
  score?:number;
  occurrences?:number;
  terms?:string[];
}
export interface ServerSearchPage {
  results:ServerSearchVerse[];
  nextCursor:number;
  complete:boolean;
  total:number;
  sha?:string;
  kind:"search"|"reference";
  engineVersion?:number;
}
export class ScriptureApiError extends Error {
  status:number;
  code:string;
  retryAfter?:number;
  constructor(message:string,status=0,code="network_error",retryAfter?:number) {
    super(message);this.name="ScriptureApiError";this.status=status;this.code=code;this.retryAfter=retryAfter;
  }
}
function translationId(value:string):string {
  const normalized=value.toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,29}$/.test(normalized)) throw new ScriptureApiError("Invalid translation identifier",400,"invalid_translation");
  return normalized;
}
function abortError():Error { const error=new Error("Request cancelled");error.name="AbortError";return error; }
const OSIS_BOOKS = "Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev".split(" ");
const OSIS_IDS = new Map(OSIS_BOOKS.map((book,index)=>[book.toLowerCase(),index+1]));
const OSIS_POINT = /^([1-4]?[a-z][a-z0-9]*)\.(\d+)(?:\.(\d+))?$/i;

/** Convert source OSIS pointers while leaving ordinary user references untouched. */
export function normalizeScriptureReference(reference:string):string {
  const text=reference.trim(),parts=text.split(/[\s;]+/).filter(Boolean);
  if (!parts.length || !parts.every(part=>OSIS_POINT.test(part.split("-")[0]))) return text;
  return parts.map(part=>{
    const [startText,endText,...extra]=part.split("-");
    if (extra.length) throw new ScriptureApiError("This source reference has an unsupported range",400,"unsupported_reference");
    const start=startText.match(OSIS_POINT)!;
    const book=OSIS_IDS.get(start[1].toLowerCase()) ?? start[1];
    const chapter=Number(start[2]),verse=start[3]===undefined?undefined:Number(start[3]);
    for (const value of [chapter,...(verse===undefined?[]:[verse])]) {
      if (!Number.isSafeInteger(value) || value<1) throw new ScriptureApiError("Invalid Scripture position",400,"invalid_reference");
    }
    const base=`${book} ${chapter}${verse===undefined?"":`:${verse}`}`;
    if (!endText) return base;
    const end=endText.match(OSIS_POINT);
    const endVerse=/^\d+$/.test(endText)?Number(endText):end?.[3]===undefined?undefined:Number(end[3]);
    if (!end && !/^\d+$/.test(endText)) throw new ScriptureApiError("This source reference has an unsupported range",400,"unsupported_reference");
    const endBook=end?(OSIS_IDS.get(end[1].toLowerCase()) ?? end[1]):book;
    if (endBook!==book || (end && Number(end[2])!==chapter))
      throw new ScriptureApiError("This reference spans chapters. Open each passage separately.",400,"unsupported_reference");
    if (verse===undefined || endVerse===undefined || !Number.isSafeInteger(endVerse) || endVerse<verse)
      throw new ScriptureApiError("Invalid Scripture range",400,"invalid_reference");
    return `${base}${endVerse===verse?"":`-${endVerse}`}`;
  }).join(";");
}
async function cachedQuery(url:string):Promise<SavedQuery|null> {
  if (queryMemory.has(url)) return queryMemory.get(url)!;
  try {
    const response=await (await caches.open(QUERY_CACHE)).match(url);
    if (!response) return null;
    const saved={data:await response.json() as Record<string,Chapter>,savedAt:Number(response.headers.get("x-getbible-cached-at")) || 0};
    validateQuery(saved.data);
    rememberQuery(url,saved);
    return saved;
  } catch { return null; }
}
function rememberQuery(url:string,saved:SavedQuery):void {
  queryMemory.delete(url);queryMemory.set(url,saved);
  while (queryMemory.size>48) queryMemory.delete(queryMemory.keys().next().value!);
}
async function saveQuery(url:string,data:Record<string,Chapter>,generation=queryGeneration):Promise<void> {
  if (generation!==queryGeneration) return;
  const savedAt=Date.now();
  rememberQuery(url,{data,savedAt});
  try {
    const cache=await caches.open(QUERY_CACHE);
    if (generation!==queryGeneration) return;
    await cache.put(url,new Response(JSON.stringify(data),{headers:{"content-type":"application/json","x-getbible-cached-at":String(savedAt)}}));
  } catch { /* Reference reading remains available when storage is disabled. */ }
}
export async function clearQueryCache():Promise<void> {
  queryGeneration+=1;queryMemory.clear();queryRefreshes.clear();
  try { await caches.delete(QUERY_CACHE); } catch { /* No persistent cache is available. */ }
}
async function getJson<T>(url:string,signal?:AbortSignal):Promise<T> {
  if (signal?.aborted) throw abortError();
  const controller=new AbortController();
  const abort=()=>controller.abort();
  signal?.addEventListener("abort",abort,{once:true});
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},45_000);
  try {
    const response=await fetch(url,{headers:{Accept:"application/json"},signal:controller.signal});
    const body=await response.json().catch(()=>null) as T|{detail?:string;code?:string;retry_after?:number}|null;
    if (!response.ok) {
      const problem=body as {detail?:string;code?:string;retry_after?:number}|null;
      const retry=Number(response.headers.get("Retry-After"));
      throw new ScriptureApiError(problem?.detail || `GetBible returned HTTP ${response.status}`,response.status,
        problem?.code || "api_error",problem?.retry_after ?? (retry>0?retry:undefined));
    }
    if (!body || typeof body !== "object") throw new ScriptureApiError("GetBible returned an invalid response",502,"invalid_response");
    return body as T;
  } catch(error) {
    if (signal?.aborted) throw abortError();
    if (timedOut) throw new ScriptureApiError("The Scripture request timed out. Please try again.",503,"request_timeout");
    if (error instanceof ScriptureApiError) throw error;
    throw new ScriptureApiError(error instanceof Error?error.message:"Could not reach GetBible");
  } finally {
    clearTimeout(timer);signal?.removeEventListener("abort",abort);
  }
}

function validateQuery(result:Record<string,Chapter>):Chapter[] {
  const chapters=Object.values(result);
  if (!chapters.length) throw new ScriptureApiError("No Scripture was found for this reference",404,"reference_not_found");
  if (chapters.some(chapter=>!chapter || !Array.isArray(chapter.verses))) throw new ScriptureApiError("GetBible returned an invalid passage",502,"invalid_response");
  return chapters;
}

function refreshQuery(url:string):void {
  if (queryRefreshes.has(url) || (typeof navigator!=="undefined" && navigator.onLine===false)) return;
  const generation=queryGeneration;
  const request=getJson<Record<string,Chapter>>(url).then(async data=>{
    validateQuery(data);
    await saveQuery(url,data,generation);
  }).catch(()=>{ /* Keep saved Scripture usable if background refresh fails. */ }).finally(()=>{
    if (queryRefreshes.get(url)===request) queryRefreshes.delete(url);
  });
  queryRefreshes.set(url,request);
}

/** Resolve references immediately from saved data; refresh monthly without blocking reading. */
export async function queryScripture(translation:string,reference:string,signal?:AbortSignal):Promise<Chapter[]> {
  if (signal?.aborted) throw abortError();
  const abbr=translationId(translation),text=normalizeScriptureReference(reference);
  if (!text || text.length>512) throw new ScriptureApiError("Enter a Scripture reference of at most 512 characters",400,"invalid_reference");
  const url=`${QUERY_ROOT}/${encodeURIComponent(abbr)}/${encodeURIComponent(text)}`;
  const saved=await cachedQuery(url);
  if (signal?.aborted) throw abortError();
  if (saved) {
    if (!isCacheFresh(saved.savedAt)) refreshQuery(url);
    return validateQuery(saved.data);
  }
  const generation=queryGeneration;
  const result=await getJson<Record<string,Chapter>>(url,signal);
  const chapters=validateQuery(result);
  if (signal?.aborted) throw abortError();
  await saveQuery(url,result,generation);
  if (signal?.aborted) throw abortError();
  return chapters;
}

/** Numeric book identity plus a space is accepted across translation languages. */
export function coordinateReference(book:number,chapter:number,verse?:number,endVerse?:number):string {
  for (const value of [book,chapter,...(verse===undefined?[]:[verse]),...(endVerse===undefined?[]:[endVerse])]) {
    if (!Number.isSafeInteger(value) || value<1) throw new ScriptureApiError("Invalid Scripture position",400,"invalid_reference");
  }
  if (endVerse!==undefined && (verse===undefined || endVerse<verse)) throw new ScriptureApiError("Invalid Scripture range",400,"invalid_reference");
  return `${book} ${chapter}${verse===undefined?"":`:${verse}${endVerse===undefined||endVerse===verse?"":`-${endVerse}`}`}`;
}

type SearchResponse = {
  query:{kind:"search"|"reference";total:number;returned:number;offset?:number;limit?:number;has_more?:boolean;sha?:string|null;engine_version?:number};
  results:Record<string,Chapter>;
  matches:Array<{reference:string;book_nr:number;chapter:number;verse:number;score?:number;occurrences?:number;terms?:string[]}>;
};
const reverseSearches=new Map<string,{total:number;sha?:string|null;engineVersion?:number}>();
const MAX_SEARCH_OFFSET=10_000;
const MAX_SEARCH_LIMIT=100;

async function searchPage(url:string,signal?:AbortSignal):Promise<SearchResponse> {
  const page=await getJson<SearchResponse>(url,signal);
  if (!page.query || !page.results || !Array.isArray(page.matches) || !["search","reference"].includes(page.query.kind)
    || !Number.isSafeInteger(page.query.total) || page.query.total<0 || !Number.isSafeInteger(page.query.returned)
    || page.query.returned!==page.matches.length)
    throw new ScriptureApiError("GetBible returned an invalid search page",502,"invalid_response");
  return page;
}

/** Server search preserves match order; its chapter map is not the ranked result list. */
export async function searchScripture(
  translation:string,query:string,options:ServerSearchOptions,offset=0,signal?:AbortSignal,
):Promise<ServerSearchPage> {
  const abbr=translationId(translation),text=query.trim(),limit=options.limit ?? 25;
  if (!text || text.length>500) throw new ScriptureApiError("Enter search text of at most 500 characters",400,"invalid_search");
  const reverse=options.sort==="canonical_desc";
  if (!Number.isInteger(offset) || offset<0 || offset>MAX_SEARCH_OFFSET+MAX_SEARCH_LIMIT || !Number.isInteger(limit) || limit<1 || limit>MAX_SEARCH_LIMIT)
    throw new ScriptureApiError("Search pagination is outside the supported range",400,"invalid_search");
  const parameters=new URLSearchParams({
    q:text,words:options.words,match:options.match==="exact"?"whole_word":"substring",
    case_sensitive:String(options.caseSensitive),sort:reverse?"canonical":options.sort ?? "canonical",diacritics:options.diacritics ?? "fold",
    limit:String(limit),offset:String(offset),
  });
  if (options.scope.startsWith("book:")) {
    parameters.set("scope","bible");parameters.append("book",options.scope.slice(5));
  } else parameters.set("scope",options.scope==="ot"?"old_testament":options.scope==="nt"?"new_testament":options.scope==="deuterocanon"?"deuterocanon":"bible");
  for (const book of options.books ?? []) parameters.append("book",String(book));
  for (const excluded of options.exclude ?? []) parameters.append("exclude",excluded);
  if (options.words==="all" && options.proximity !== undefined) parameters.set("proximity",String(options.proximity));
  const endpoint=`${SEARCH_ROOT}/${encodeURIComponent(abbr)}?`;
  let page:SearchResponse;
  if (reverse) {
    // The API only supports ascending canonical order. Page from its real end,
    // keeping the cursor as the number of reverse-ordered results already read.
    const criteria=new URLSearchParams(parameters);criteria.delete("offset");
    const key=`${endpoint}${criteria}`;
    let known=offset===0?undefined:reverseSearches.get(key);
    let firstPage:SearchResponse|undefined;
    if (!known) {
      parameters.set("offset","0");
      firstPage=await searchPage(`${endpoint}${parameters}`,signal);
      if (firstPage.query.kind==="reference") {
        page=firstPage;
      } else {
        known={total:firstPage.query.total,sha:firstPage.query.sha,engineVersion:firstPage.query.engine_version};
        reverseSearches.delete(key);reverseSearches.set(key,known);
        while (reverseSearches.size>20) reverseSearches.delete(reverseSearches.keys().next().value!);
      }
    }
    if (known) {
      if (known.total>MAX_SEARCH_OFFSET+MAX_SEARCH_LIMIT)
        throw new ScriptureApiError("This search has too many results to reverse. Choose a Testament or book, or refine the search to 10,100 results or fewer.",400,"reverse_search_limit");
      const end=Math.max(0,known.total-offset),start=Math.max(0,end-limit);
      if (end===0) {
        page={query:{kind:"search",total:known.total,returned:0,has_more:false,sha:known.sha,engine_version:known.engineVersion},results:{},matches:[]};
      } else if (firstPage && start===0 && end===firstPage.query.returned) {
        page=firstPage;
      } else {
        const serverOffset=Math.min(start,MAX_SEARCH_OFFSET);
        parameters.set("offset",String(serverOffset));parameters.set("limit",String(end-serverOffset));
        page=await searchPage(`${endpoint}${parameters}`,signal);
        if (page.query.kind!=="search" || page.query.total!==known.total
          || page.query.sha!==known.sha || page.query.engine_version!==known.engineVersion)
          throw new ScriptureApiError("The translation changed during this search. Run your search again.",409,"search_changed");
        const matches=page.matches.slice(start-serverOffset,end-serverOffset);
        if (matches.length!==end-start) throw new ScriptureApiError("GetBible returned an incomplete search page. Run your search again.",502,"invalid_response");
        page={...page,matches,query:{...page.query,returned:matches.length}};
      }
    } else {
      page=firstPage!;
    }
  } else {
    // A final request can include up to 100 results after offset 10,000.
    // Expand that last page and discard any overlap when a prior page crossed
    // the offset boundary, so every reachable result remains available.
    const serverOffset=Math.min(offset,MAX_SEARCH_OFFSET);
    parameters.set("offset",String(serverOffset));
    if (offset+limit>MAX_SEARCH_OFFSET) parameters.set("limit",String(MAX_SEARCH_LIMIT));
    page=await searchPage(`${endpoint}${parameters}`,signal);
    if (page.query.kind==="search" && offset>serverOffset) {
      const matches=page.matches.slice(offset-serverOffset);
      page={...page,matches,query:{...page.query,offset,returned:matches.length}};
    }
  }
  const results=page.matches.map(match=>{
    const chapter=page.results[`${abbr}_${match.book_nr}_${match.chapter}`];
    const verse=chapter?.verses.find(item=>item.verse===match.verse);
    if (!chapter || !verse) throw new ScriptureApiError("GetBible search results contain an unavailable verse",502,"invalid_response");
    return {
      book:match.book_nr,bookName:chapter.book_name,chapter:match.chapter,verse:match.verse,
      reference:match.reference,text:verse.text,verseData:verse,
      ...(match.score===undefined?{}:{score:match.score}),
      ...(match.occurrences===undefined?{}:{occurrences:match.occurrences}),
      ...(match.terms===undefined?{}:{terms:match.terms}),
    };
  });
  if (reverse) results.reverse();
  const nextCursor=page.query.kind==="search"?(reverse?offset:page.query.offset ?? offset)+page.query.returned:results.length;
  return {
    results,nextCursor,complete:page.query.kind==="reference" || page.query.returned===0 || (reverse?nextCursor>=page.query.total:!page.query.has_more || nextCursor>=MAX_SEARCH_OFFSET+MAX_SEARCH_LIMIT),
    total:page.query.total,kind:page.query.kind,
    ...(typeof page.query.sha==="string"?{sha:page.query.sha}:{}),
    ...(page.query.engine_version===undefined?{}:{engineVersion:page.query.engine_version}),
  };
}
