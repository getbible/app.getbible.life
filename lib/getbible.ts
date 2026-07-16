export const API_ROOT = "https://api.getbible.net/v2";
export const WEEK_MS = 604_800_000;

export type Direction = "LTR" | "RTL" | string;
export interface Translation {
  translation:string;
  abbreviation:string;
  description?:string;
  lang:string;
  language:string;
  direction:Direction;
  encoding?:string;
  distribution_lcsh?:string;
  distribution_version?:string;
  distribution_version_date?:string;
  distribution_abbreviation?:string;
  distribution_about?:string;
  distribution_license?:string;
  distribution_sourcetype?:string;
  distribution_source?:string;
  distribution_versification?:string;
  distribution_history?:Record<string,string>;
  url?:string;
  sha:string;
  [key:string]:unknown;
}
export interface Book { nr:number; name:string; sha:string; direction:Direction }
export interface ChapterInfo { chapter:number; name:string; sha:string }
export interface Verse { chapter:number; verse:number; name:string; text:string }
export interface Chapter { translation:string; abbreviation:string; language:string; direction:Direction; book_nr:number; book_name:string; chapter:number; name:string; verses:Verse[] }
export interface WholeTranslationChapter { chapter:number; name:string; verses:Verse[] }
export interface WholeTranslationBook { nr:number; name:string; chapters:WholeTranslationChapter[] }
export interface WholeTranslation { translation:string; abbreviation:string; language:string; lang:string; direction:Direction; books:WholeTranslationBook[] }
export interface Passage { translation:string; book:number; chapter:number }

export const valuesByNumber = <T>(record:Record<string,T>):T[] =>
  Object.entries(record).sort(([a],[b]) => Number(a)-Number(b)).map(([,value]) => value);

export function resolvedLanguageName(language:string|undefined, lang:string|undefined):string {
  const explicit=language?.trim();
  if(explicit) return explicit;
  const code=lang?.trim();
  if(!code) return "Unknown";
  try {
    const resolved=new Intl.DisplayNames(["en"],{type:"language"}).of(code);
    return resolved && resolved.toLocaleLowerCase()!==code.toLocaleLowerCase() ? resolved : code.toLocaleUpperCase();
  } catch { return code.toLocaleUpperCase(); }
}

export const translationLanguage = (translation:Translation):string =>
  resolvedLanguageName(translation.language,translation.lang);

export const translationValues = (record:Record<string,Translation>):Translation[] =>
  Object.values(record).sort((a,b) => translationLanguage(a).localeCompare(translationLanguage(b)) || a.translation.localeCompare(b.translation));

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

export interface FriendlyPassage { translation:string; bookSlug:string; chapter:number }

export function bookSlug(name:string):string {
  return name.normalize("NFC").trim().replace(/[\s_/]+/g,"-").replace(/^-+|-+$/g,"");
}

export function passagePath(value:Passage, bookName:string):string {
  return `/${encodeURIComponent(value.translation.toUpperCase())}/${encodeURIComponent(bookSlug(bookName))}/${value.chapter}`;
}

export function getBibleLifeUrl(value:Passage, bookName:string):string {
  return `https://getbible.life/${encodeURIComponent(value.translation.toUpperCase())}/${encodeURIComponent(bookName.trim())}/${value.chapter}`;
}

export function parsePassagePath(pathname:string):FriendlyPassage|null {
  const parts=pathname.split("/").filter(Boolean);
  if(parts.length!==3) return null;
  try {
    const translation=decodeURIComponent(parts[0]).toLowerCase();
    const book=decodeURIComponent(parts[1]);
    const chapter=Number(parts[2]);
    if(!/^[a-z0-9_-]+$/.test(translation)||!book||!Number.isSafeInteger(chapter)||chapter<1) return null;
    return {translation,bookSlug:book,chapter};
  } catch { return null; }
}

export function bookMatchesSlug(name:string, slug:string):boolean {
  const normalize=(value:string)=>bookSlug(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
  return normalize(name)===normalize(slug);
}

export const fresh = (checkedAt:number, now=Date.now()):boolean => checkedAt > 0 && now-checkedAt < WEEK_MS;
export const validSha = (sha:string):boolean => /^[a-f0-9]{40}$/i.test(sha.trim());
