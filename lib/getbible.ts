export const API_ROOT = "https://api.getbible.net/v2";
export const WEEK_MS = 604_800_000;

export type Direction = "LTR" | "RTL" | string;
export interface Translation { translation:string; abbreviation:string; language:string; lang:string; direction:Direction; distribution_license?:string; sha:string }
export interface Book { nr:number; name:string; sha:string; direction:Direction }
export interface ChapterInfo { chapter:number; name:string; sha:string }
export interface Verse { chapter:number; verse:number; name:string; text:string }
export interface Chapter { translation:string; abbreviation:string; language:string; direction:Direction; book_nr:number; book_name:string; chapter:number; name:string; verses:Verse[] }
export interface Passage { translation:string; book:number; chapter:number }

export const valuesByNumber = <T>(record:Record<string,T>):T[] =>
  Object.entries(record).sort(([a],[b]) => Number(a)-Number(b)).map(([,value]) => value);

export const translationValues = (record:Record<string,Translation>):Translation[] =>
  Object.values(record).sort((a,b) => a.language.localeCompare(b.language) || a.translation.localeCompare(b.translation));

export function parsePassage(search:string):Passage {
  const params = new URLSearchParams(search);
  const raw = (params.get("translation") || "kjv").toLowerCase();
  const book = Number(params.get("book") || 43);
  const chapter = Number(params.get("chapter") || 3);
  return {
    translation: /^[a-z0-9_-]+$/.test(raw) ? raw : "kjv",
    book: Number.isSafeInteger(book) && book > 0 ? book : 43,
    chapter: Number.isSafeInteger(chapter) && chapter > 0 ? chapter : 3,
  };
}

export function passageSearch(value:Passage):string {
  return `?${new URLSearchParams({translation:value.translation,book:String(value.book),chapter:String(value.chapter)})}`;
}

export const fresh = (checkedAt:number, now=Date.now()):boolean => checkedAt > 0 && now-checkedAt < WEEK_MS;
export const validSha = (sha:string):boolean => /^[a-f0-9]{40}$/i.test(sha.trim());
