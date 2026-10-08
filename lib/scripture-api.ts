import type { Chapter, Verse } from "./getbible.ts";
import type { SearchOptions, SearchVerse } from "./search.ts";

export const QUERY_ROOT = "https://query.getbible.net/v3";
export const SEARCH_ROOT = "https://search.getbible.net/v3";
const QUERY_CACHE = "getbible-query-v3";
const queryMemory = new Map<string,Record<string,Chapter>>();
export type ServerSearchOptions = Omit<SearchOptions,"scope"> & {
  scope:SearchOptions["scope"]|"deuterocanon";
  sort?:"canonical"|"relevance";
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
async function cachedQuery(url:string):Promise<Record<string,Chapter>|null> {
  if (queryMemory.has(url)) return queryMemory.get(url)!;
  try {
    const response=await (await caches.open(QUERY_CACHE)).match(url);
    return response?await response.json() as Record<string,Chapter>:null;
  } catch { return null; }
}
async function saveQuery(url:string,data:Record<string,Chapter>):Promise<void> {
  queryMemory.delete(url);queryMemory.set(url,data);
  while (queryMemory.size>48) queryMemory.delete(queryMemory.keys().next().value!);
  try {
    await (await caches.open(QUERY_CACHE)).put(url,new Response(JSON.stringify(data),{headers:{"content-type":"application/json"}}));
  } catch { /* Reference reading remains available when storage is disabled. */ }
}
export async function clearQueryCache():Promise<void> {
  queryMemory.clear();
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

/** Resolve single, ranged or semicolon-chained references as one encoded path segment. */
export async function queryScripture(translation:string,reference:string,signal?:AbortSignal):Promise<Chapter[]> {
  const abbr=translationId(translation),text=normalizeScriptureReference(reference);
  if (!text || text.length>512) throw new ScriptureApiError("Enter a Scripture reference of at most 512 characters",400,"invalid_reference");
  const url=`${QUERY_ROOT}/${encodeURIComponent(abbr)}/${encodeURIComponent(text)}`;
  let result:Record<string,Chapter>;
  let fromCache=false;
  try { result=await getJson<Record<string,Chapter>>(url,signal); }
  catch(error) {
    if (signal?.aborted || !(error instanceof ScriptureApiError) || (error.status!==0 && error.status<500)) throw error;
    const saved=await cachedQuery(url);
    if (signal?.aborted) throw abortError();
    if (!saved) throw error;
    result=saved;fromCache=true;
  }
  const chapters=Object.values(result);
  if (!chapters.length) throw new ScriptureApiError("No Scripture was found for this reference",404,"reference_not_found");
  if (chapters.some(chapter=>!chapter || !Array.isArray(chapter.verses))) throw new ScriptureApiError("GetBible returned an invalid passage",502,"invalid_response");
  if (signal?.aborted) throw abortError();
  if (!fromCache) await saveQuery(url,result);
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

/** Server search preserves match order; its chapter map is not the ranked result list. */
export async function searchScripture(
  translation:string,query:string,options:ServerSearchOptions,offset=0,signal?:AbortSignal,
):Promise<ServerSearchPage> {
  const abbr=translationId(translation),text=query.trim(),limit=options.limit ?? 25;
  if (!text || text.length>500) throw new ScriptureApiError("Enter search text of at most 500 characters",400,"invalid_search");
  if (!Number.isInteger(offset) || offset<0 || offset>10_000 || !Number.isInteger(limit) || limit<1 || limit>100)
    throw new ScriptureApiError("Search pagination is outside the supported range",400,"invalid_search");
  const parameters=new URLSearchParams({
    q:text,words:options.words,match:options.match==="exact"?"whole_word":"substring",
    case_sensitive:String(options.caseSensitive),sort:options.sort ?? "canonical",diacritics:options.diacritics ?? "fold",
    limit:String(limit),offset:String(offset),
  });
  if (options.scope.startsWith("book:")) {
    parameters.set("scope","bible");parameters.append("book",options.scope.slice(5));
  } else parameters.set("scope",options.scope==="ot"?"old_testament":options.scope==="nt"?"new_testament":options.scope==="deuterocanon"?"deuterocanon":"bible");
  for (const book of options.books ?? []) parameters.append("book",String(book));
  for (const excluded of options.exclude ?? []) parameters.append("exclude",excluded);
  if (options.words==="all" && options.proximity !== undefined) parameters.set("proximity",String(options.proximity));
  const page=await getJson<SearchResponse>(`${SEARCH_ROOT}/${encodeURIComponent(abbr)}?${parameters}`,signal);
  if (!page.query || !page.results || !Array.isArray(page.matches) || !["search","reference"].includes(page.query.kind))
    throw new ScriptureApiError("GetBible returned an invalid search page",502,"invalid_response");
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
  const nextCursor=page.query.kind==="search"?(page.query.offset ?? offset)+page.query.returned:results.length;
  return {
    results,nextCursor,complete:page.query.kind==="reference" || !page.query.has_more || page.query.returned===0 || nextCursor>10_000,
    total:page.query.total,kind:page.query.kind,
    ...(typeof page.query.sha==="string"?{sha:page.query.sha}:{}),
    ...(page.query.engine_version===undefined?{}:{engineVersion:page.query.engine_version}),
  };
}
