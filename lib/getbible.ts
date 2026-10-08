export const API_ROOT = "https://api.getbible.net/v3";
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
export interface Book { nr:number; name:string; sha:string; direction:Direction; url?:string }
export interface ChapterInfo { chapter:number; name:string; sha:string; url?:string }
/** Display-word coordinates are one-based and inclusive; zero means unlocated. */
export interface Token {
  token:string;
  word_start:number;
  word_end:number;
  lemma?:Record<string,string[]>;
  morph?:Record<string,string[]>;
  xlit?:Record<string,string[]>;
  src?:Array<number|string>;
  gloss?:string;
  n?:string;
  type?:string;
  subType?:string;
  variantType?:string;
  variant?:boolean;
  morphSegmented?:boolean;
  [key:string]:unknown;
}
/** Token coordinates are zero-based inclusive indexes, distinct from word positions. */
export interface Span {
  tag:string;
  span:string;
  token_start:number;
  token_end:number;
  word_start:number;
  word_end:number;
  attrs?:Record<string,string>;
}
export type Editorial =
  | {order:number;type:"heading";anchor:{verse:number;edge:"before"};text:string;heading_type:string;canonical:boolean}
  | {order:number;type:"paragraph";start:number;end:number};
export interface Introduction { text:string; [key:string]:unknown }
export interface Title { text:string;type?:string;canonical?:boolean;subtype?:string;tokens?:Token[];spans?:Span[] }
export interface Verse { chapter:number; verse:number; name:string; text:string; paragraph?:boolean; tokens?:Token[]; spans?:Span[]; [key:string]:unknown }
export interface WholeTranslationChapter {
  chapter:number;
  name:string;
  verses:Verse[];
  editorial?:Editorial[];
  introduction?:Introduction[];
  titles?:Title[];
  [key:string]:unknown;
}
export interface Chapter extends WholeTranslationChapter {
  translation:string;
  abbreviation:string;
  language:string;
  lang?:string;
  direction:Direction;
  encoding?:string;
  book_nr:number;
  book_name:string;
  ref?:string[];
}
export interface WholeTranslationBook { nr:number; name:string; chapters:WholeTranslationChapter[];titles?:Title[];introduction?:Introduction[];[key:string]:unknown }
export interface WholeTranslation { translation:string; abbreviation:string; language:string; lang:string; direction:Direction;encoding?:string;books:WholeTranslationBook[];titles?:Title[];introduction?:Introduction[];[key:string]:unknown }
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
