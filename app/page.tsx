"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Book, Chapter, ChapterInfo, Passage, Translation, parsePassage, passageSearch, translationValues, valuesByNumber } from "../lib/getbible";
import { books as loadBooks, chapter as loadChapter, chapters as loadChapters, clearCache, translations as loadTranslations } from "../lib/cache";

const LAST="getbible-reader:last:v1", THEME="getbible-reader:theme:v1", SIZE="getbible-reader:size:v1";
const initial:Passage={translation:"kjv",book:43,chapter:3};

export default function Home(){
  const [route,setRoute]=useState<Passage>(initial), [ready,setReady]=useState(false), [loading,setLoading]=useState(true);
  const [translations,setTranslations]=useState<Translation[]>([]), [translation,setTranslation]=useState<Translation|null>(null);
  const [books,setBooks]=useState<Book[]>([]), [chapters,setChapters]=useState<ChapterInfo[]>([]), [passage,setPassage]=useState<Chapter|null>(null);
  const [error,setError]=useState(""), [verified,setVerified]=useState(true), [dark,setDark]=useState(false), [size,setSize]=useState(20);
  const active=useRef(0), touch=useRef<number|null>(null);

  useEffect(()=>{ const timer=setTimeout(()=>{ let next=parsePassage(location.search); if(!location.search){try{next=JSON.parse(localStorage.getItem(LAST)||"null")||initial}catch{next=initial}} setRoute(next); setDark(document.documentElement.dataset.theme==="dark"); setSize(Math.min(28,Math.max(16,Number(localStorage.getItem(SIZE))||20))); setReady(true)},0); const pop=()=>setRoute(parsePassage(location.search)); addEventListener("popstate",pop); return()=>{clearTimeout(timer);removeEventListener("popstate",pop)} },[]);

  const go=useCallback((next:Passage,replace=false)=>{ history[replace?"replaceState":"pushState"]({},"",`${location.pathname}${passageSearch(next)}`); localStorage.setItem(LAST,JSON.stringify(next)); setRoute(next) },[]);

  useEffect(()=>{ if(!ready)return; const id=++active.current; const loadingTimer=setTimeout(()=>{setLoading(true);setError("")},0); (async()=>{
    try{
      const tr=await loadTranslations(), allTranslations=translationValues(tr.data), selected=allTranslations.find(x=>x.abbreviation===route.translation)||allTranslations.find(x=>x.abbreviation==="kjv")||allTranslations[0];
      if(!selected) throw new Error("No translations are available.");
      const br=await loadBooks(selected.abbreviation), allBooks=valuesByNumber(br.data), book=allBooks.find(x=>x.nr===route.book)||allBooks[0]; if(!book)throw new Error("This translation has no books.");
      const cr=await loadChapters(selected.abbreviation,book.nr), allChapters=valuesByNumber(cr.data), ch=allChapters.find(x=>x.chapter===route.chapter)||allChapters[0]; if(!ch)throw new Error("This book has no chapters.");
      const normalized={translation:selected.abbreviation,book:book.nr,chapter:ch.chapter};
      if(normalized.translation!==route.translation||normalized.book!==route.book||normalized.chapter!==route.chapter){go(normalized,true);return}
      const text=await loadChapter(normalized.translation,normalized.book,normalized.chapter); if(id!==active.current)return;
      setTranslations(allTranslations);setTranslation(selected);setBooks(allBooks);setChapters(allChapters);setPassage(text.data);setVerified(text.verified);document.title=`${text.data.name} · ${selected.translation}`;scrollTo({top:0,behavior:"smooth"});
    }catch(caught){if(id===active.current)setError(caught instanceof Error?caught.message:"The passage could not be loaded.")}finally{if(id===active.current)setLoading(false)}
  })(); return()=>clearTimeout(loadingTimer) },[go,ready,route]);

  const turn=useCallback(async(delta:-1|1)=>{ if(!passage)return; const ci=chapters.findIndex(x=>x.chapter===route.chapter), adjacent=chapters[ci+delta]; if(adjacent){go({...route,chapter:adjacent.chapter});return} const bi=books.findIndex(x=>x.nr===route.book), nextBook=books[bi+delta]; if(!nextBook)return; const list=valuesByNumber((await loadChapters(route.translation,nextBook.nr)).data), next=delta===1?list[0]:list.at(-1); if(next)go({...route,book:nextBook.nr,chapter:next.chapter}) },[books,chapters,go,passage,route]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.altKey&&event.key==="ArrowLeft")void turn(-1);if(event.altKey&&event.key==="ArrowRight")void turn(1)};addEventListener("keydown",key);return()=>removeEventListener("keydown",key)},[turn]);

  const chapterIndex=chapters.findIndex(x=>x.chapter===route.chapter), bookIndex=books.findIndex(x=>x.nr===route.book), previous=chapterIndex>0||bookIndex>0, next=chapterIndex<chapters.length-1||bookIndex<books.length-1;
  const theme=()=>{const value=!dark;setDark(value);document.documentElement.dataset.theme=value?"dark":"light";localStorage.setItem(THEME,value?"dark":"light")};
  const resize=(value:number)=>{value=Math.min(28,Math.max(16,value));setSize(value);localStorage.setItem(SIZE,String(value))};

  return <main>
    <header className="topbar"><Link className="brand" href="/">GetBible <small>Reader</small></Link><nav aria-label="Passage selection">
      <label><span>Translation</span><select aria-label="Translation" value={route.translation} disabled={!translations.length} onChange={e=>go({...route,translation:e.target.value})}>{translations.map(x=><option value={x.abbreviation} key={x.abbreviation}>{x.language} · {x.translation}</option>)}</select></label>
      <label><span>Book</span><select aria-label="Book" value={route.book} disabled={!books.length} onChange={e=>go({...route,book:Number(e.target.value),chapter:1})}>{books.map(x=><option value={x.nr} key={x.nr}>{x.name}</option>)}</select></label>
      <label className="short"><span>Chapter</span><select aria-label="Chapter" value={route.chapter} disabled={!chapters.length} onChange={e=>go({...route,chapter:Number(e.target.value)})}>{chapters.map(x=><option value={x.chapter} key={x.chapter}>{x.chapter}</option>)}</select></label>
    </nav><button className="theme" onClick={theme}>{dark?"Light":"Dark"}</button></header>

    <div className="layout"><aside><section><div className="side-title"><b>Chapters</b><span>{route.chapter} / {chapters.length||"—"}</span></div><div className="grid">{chapters.map(x=><button aria-current={x.chapter===route.chapter?"page":undefined} className={x.chapter===route.chapter?"active":""} key={x.chapter} onClick={()=>go({...route,chapter:x.chapter})}>{x.chapter}</button>)}</div></section>
      <section><div className="side-title"><b>Text size</b><span>{size}px</span></div><div className="sizes"><button onClick={()=>resize(size-2)} disabled={size===16}>A−</button><button onClick={()=>resize(size+2)} disabled={size===28}>A+</button></div></section>
      <section className="cache"><b className={verified?"ok":""}>{verified?"Content verified":"Saved content"}</b><p>Chapter hashes are checked whenever a passage opens. Catalogs refresh weekly.</p><button onClick={async()=>{await clearCache();setRoute({...route})}}>Clear local cache</button></section>
    </aside>
    <section className="stage"><div className="pager top"><button disabled={!previous} onClick={()=>void turn(-1)}>Previous</button><span>Alt + arrow keys</span><button disabled={!next} onClick={()=>void turn(1)}>Next</button></div>
      {error?<div className="state"><p className="eyebrow">Unable to open this passage</p><h1>The Bible text could not be reached.</h1><p>{error}</p><button onClick={()=>setRoute({...route})}>Try again</button></div>:loading||!passage?<div className="state loading"><p>Loading passage</p><i/><i/><i/><i/><i/></div>:
      <article dir={passage.direction.toLowerCase()} style={{"--size":`${size}px`} as React.CSSProperties} onTouchStart={e=>touch.current=e.changedTouches[0]?.clientX||null} onTouchEnd={e=>{if(touch.current===null)return;const distance=(e.changedTouches[0]?.clientX||touch.current)-touch.current;touch.current=null;if(Math.abs(distance)>70)void turn(distance>0?-1:1)}}>
        <header><p className="eyebrow">{translation?.translation}</p><h1>{passage.book_name}</h1><em>Chapter {passage.chapter}</em></header>
        <ol>{passage.verses.map(verse=><li id={`v${verse.verse}`} key={verse.verse}><a href={`${passageSearch(route)}#v${verse.verse}`} aria-label={`${verse.name}, link to verse`}>{verse.verse}</a><span>{verse.text}</span></li>)}</ol>
        <footer>{translation?.translation} ({translation?.abbreviation.toUpperCase()}){translation?.distribution_license&&<small>{translation.distribution_license}</small>}</footer>
      </article>}
      <div className="pager bottom"><button disabled={!previous} onClick={()=>void turn(-1)}>Previous chapter</button><button disabled={!next} onClick={()=>void turn(1)}>Next chapter</button></div>
    </section></div>
    <div className="mobile"><button disabled={!previous} onClick={()=>void turn(-1)}>Previous</button><span>{passage?.name||"Loading"}</span><button disabled={!next} onClick={()=>void turn(1)}>Next</button></div>
  </main>
}
