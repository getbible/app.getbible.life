"use client";

import { useEffect, useRef, useState } from "react";
import {
  commentsForVerse, defaultDictionary, downloadCommentary, downloadDictionary,
  getCommentaryBooks, getCommentaryCatalog, getCommentaryChapter, getCommentaryMetadata,
  getDictionaryCatalog, getDictionaryMetadata, isStudyDownloaded,
  normalizeStudyTerm, removeStudyDownload, scriptureReferenceQuery, studyTextSegments,
  type CommentaryChapter, type CommentaryEntry, type CommentarySummary, type DictionaryCatalog,
  type DictionarySummary, type ScriptureReference, type StudyMetadata,
} from "@/lib/study-api";
import { lookupDictionaries, type DictionaryLookupResult } from "@/lib/dictionary-lookup";
import { defaultCommentary } from "@/lib/commentary-preference";
import { useDialog } from "./useDialog";
import "./study.css";

export interface StudyPanelProps {
  translation: string; language: string; book: number; chapter: number; verse?: number;
  word?: string; strong?: string[]; onClose: () => void;
  onReference: (reference: string) => void; onSearch: (text: string) => void;
}
type Tab = "dictionary" | "commentary";
const EMPTY_STRONG: string[] = [];
const preferenceKey = (kind: Tab, language: string) => `getbible-study:${kind}:${language.toLowerCase()}`;
function remembered(kind: Tab, language: string): string | null {
  try { return localStorage.getItem(preferenceKey(kind, language)); } catch { return null; }
}
function remember(kind: Tab, language: string, id: string) {
  try { localStorage.setItem(preferenceKey(kind, language), id); } catch { /* A private session can still use the panel. */ }
}
const message = (error: unknown) => error instanceof Error ? error.message : "The study resource could not be loaded.";
const cancelled = (error: unknown) => error instanceof Error && error.name === "AbortError";
const formatSize = (bytes: number) => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.ceil(bytes / 1_000)} KB`;
function resourceOrder<T extends { language: string; name: string }>(resources: T[], language: string): T[] {
  const score = (item: T) => item.language === language ? 2 : item.language === "en" ? 1 : 0;
  return [...resources].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

/** Context changes reset the lookup while a reference modal can sit above it. */
export function StudyPanel(props: StudyPanelProps) {
  return <StudyContent key={`${props.translation}/${props.book}/${props.chapter}/${props.verse ?? "all"}/${props.word ?? ""}/${props.strong?.join(",") ?? ""}`} {...props} />;
}
export default StudyPanel;

function CitationText({ text, references, onReference }: { text: string; references?: ScriptureReference[]; onReference: (reference: string) => void }) {
  const segments = studyTextSegments(text, references);
  const linked = new Set(segments.map((segment) => segment.reference));
  const unlocated = (references ?? []).filter((reference) => !linked.has(reference));
  return <>
    <div className="study-prose">{segments.map((segment, index) => segment.reference && segment.reference.chapter > 0
      ? <button className="study-reference" type="button" key={index} onClick={() => onReference(scriptureReferenceQuery(segment.reference!))} title={`Read ${segment.reference.ref}`}>{segment.text}</button>
      : <span key={index}>{segment.text}</span>)}</div>
    {unlocated.length ? <div className="study-citations" aria-label="Scripture references">{unlocated.filter((reference) => reference.chapter > 0).map((reference, index) => <button type="button" key={`${reference.ref}/${index}`} onClick={() => onReference(scriptureReferenceQuery(reference))}>{reference.ref}</button>)}</div> : null}
  </>;
}

function StudyContent({ translation, language, book, chapter, verse, word, strong = EMPTY_STRONG, onClose, onReference, onSearch }: StudyPanelProps) {
  const root = useRef<HTMLElement>(null);
  useDialog(root, onClose);
  const [tab, setTab] = useState<Tab>(word !== undefined || strong.length ? "dictionary" : "commentary");
  const [dictionaries, setDictionaries] = useState<DictionarySummary[] | null>(null);
  const [dictionaryCatalog, setDictionaryCatalog] = useState<DictionaryCatalog | null>(null);
  const [commentaries, setCommentaries] = useState<CommentarySummary[] | null>(null);
  const [dictionary, setDictionary] = useState("");
  const [commentary, setCommentary] = useState("");
  const [catalogErrors, setCatalogErrors] = useState<Partial<Record<Tab, string>>>({});
  const [retry, setRetry] = useState(0);
  const [input, setInput] = useState(word ?? "");
  const [term, setTerm] = useState(word ?? "");
  const [explicitEntry, setExplicitEntry] = useState<{ dictionary: string; entry: string } | null>(null);
  const [lookup, setLookup] = useState<DictionaryLookupResult & { key: string; error: string }>({ key: "", matches: [], suggestions: [], unavailable: [], complete: false, error: "" });
  const manualDictionary = useRef<string | null>(null);
  const [commentaryResult, setCommentaryResult] = useState<{ id: string; chapter?: CommentaryChapter; introduction?: CommentaryChapter; error: string }>({ id: "", error: "" });
  const [wholeChapter, setWholeChapter] = useState(verse === undefined);
  const [resource, setResource] = useState<{ kind: Tab; id: string; metadata?: StudyMetadata; downloaded: boolean }>({ kind: tab, id: "", downloaded: false });
  const [download, setDownload] = useState<{ kind: Tab; id: string; busy: boolean; notice: string; error: string }>({ kind: tab, id: "", busy: false, notice: "", error: "" });
  const downloadController = useRef<AbortController | null>(null);
  const selected = tab === "dictionary" ? dictionary : commentary;
  const summary = tab === "dictionary" ? dictionaries?.find((item) => item.id === dictionary) : commentaries?.find((item) => item.id === commentary);
  const currentResource = resource.kind === tab && resource.id === selected ? resource : null;
  const currentDownload = download.kind === tab && download.id === selected ? download : null;
  const activeStrong = normalizeStudyTerm(term) === normalizeStudyTerm(word ?? "") ? strong : EMPTY_STRONG;
  const lookupKey = JSON.stringify([normalizeStudyTerm(term), activeStrong, explicitEntry]);
  const dictionaryReady = lookup.key === lookupKey;
  const browsing = !normalizeStudyTerm(term) && !activeStrong.length && !explicitEntry;
  const currentLookup = dictionaryReady ? lookup : null;
  const dictionaryChoices = browsing ? dictionaries : resourceOrder(currentLookup?.matches.map((match) => match.dictionary) ?? [], language);
  const definitions = currentLookup?.matches.find((match) => match.dictionary.id === dictionary)?.entries ?? [];
  const commentaryReady = commentaryResult.id === commentary;

  useEffect(() => () => downloadController.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    if (tab === "dictionary" && !dictionaries) {
      getDictionaryCatalog(controller.signal).then((catalog) => {
        if (controller.signal.aborted) return;
        setDictionaryCatalog(catalog);
        setDictionaries(resourceOrder(catalog.dictionaries.filter((item) => item.entry_count > 0), language));
        setDictionary(defaultDictionary(catalog.dictionaries, language, strong, remembered("dictionary", language)));
        setCatalogErrors((current) => ({ ...current, dictionary: "" }));
      }).catch((error) => { if (!cancelled(error)) setCatalogErrors((current) => ({ ...current, dictionary: message(error) })); });
    }
    if (tab === "commentary" && !commentaries) {
      getCommentaryCatalog(controller.signal).then((catalog) => {
        if (controller.signal.aborted) return;
        const resources = resourceOrder(catalog.commentaries.filter((item) => item.entry_count > 0), language);
        const previous = remembered("commentary", language);
        setCommentaries(resources);
        setCommentary(defaultCommentary(resources, language, previous));
        setCatalogErrors((current) => ({ ...current, commentary: "" }));
      }).catch((error) => { if (!cancelled(error)) setCatalogErrors((current) => ({ ...current, commentary: message(error) })); });
    }
    return () => controller.abort();
  }, [tab, dictionaries, commentaries, language, strong, retry]);

  useEffect(() => {
    if (tab !== "dictionary" || !dictionaryCatalog || browsing) return;
    const controller = new AbortController();
    const contextStrong = normalizeStudyTerm(term) === normalizeStudyTerm(word ?? "") ? strong : EMPTY_STRONG;
    const preferred = explicitEntry?.dictionary ?? defaultDictionary(dictionaryCatalog.dictionaries, language, contextStrong, remembered("dictionary", language));
    const apply = (result: DictionaryLookupResult) => {
      if (controller.signal.aborted) return;
      setLookup({ ...result, key: lookupKey, error: "" });
      const resources = result.matches.map((match) => match.dictionary);
      const chosen = manualDictionary.current;
      setDictionary(resources.some((item) => item.id === chosen) ? chosen! : resources.some((item) => item.id === preferred) ? preferred : defaultDictionary(resources, language, contextStrong));
    };
    lookupDictionaries(dictionaryCatalog, term, contextStrong, { signal: controller.signal, language, retry: retry > 0, explicit: explicitEntry ?? undefined, onProgress: apply }).then(apply)
      .catch((error) => { if (!cancelled(error)) setLookup({ key: lookupKey, matches: [], suggestions: [], unavailable: [], complete: true, error: message(error) }); });
    return () => controller.abort();
  }, [tab, dictionaryCatalog, term, explicitEntry, word, strong, retry, language, lookupKey, browsing]);

  useEffect(() => {
    if (tab !== "commentary" || !commentary) return;
    const controller = new AbortController();
    getCommentaryBooks(commentary, controller.signal).then(async (index) => {
      const coverage = index.books.find((item) => item.book === book);
      const [document, introduction] = await Promise.all([
        coverage?.chapters.includes(chapter) ? getCommentaryChapter(commentary, book, chapter, controller.signal) : Promise.resolve(undefined),
        coverage?.chapters.includes(0) ? getCommentaryChapter(commentary, book, 0, controller.signal) : Promise.resolve(undefined),
      ]);
      if (!controller.signal.aborted) setCommentaryResult({ id: commentary, chapter: document, introduction, error: "" });
    }).catch((error) => { if (!cancelled(error)) setCommentaryResult({ id: commentary, error: message(error) }); });
    return () => controller.abort();
  }, [tab, commentary, book, chapter, retry]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    Promise.all([
      (tab === "dictionary" ? getDictionaryMetadata : getCommentaryMetadata)(selected, controller.signal).catch(() => undefined),
      isStudyDownloaded(tab, selected),
    ]).then(([metadata, downloaded]) => { if (!controller.signal.aborted) setResource({ kind: tab, id: selected, metadata, downloaded }); });
    return () => controller.abort();
  }, [tab, selected]);

  async function toggleDownload() {
    if (!selected || !summary) return;
    downloadController.current?.abort();
    const controller = new AbortController();
    downloadController.current = controller;
    const kind = tab, id = selected;
    setDownload({ kind, id, busy: true, notice: "", error: "" });
    try {
      if (currentResource?.downloaded) {
        await removeStudyDownload(kind, id);
        if (!controller.signal.aborted) {
          setResource((current) => current.kind === kind && current.id === id ? { ...current, downloaded: false } : current);
          setDownload({ kind, id, busy: false, notice: "Full offline download removed. Previously read entries may still be cached.", error: "" });
        }
      } else {
        await (kind === "dictionary" ? downloadDictionary : downloadCommentary)(id, controller.signal);
        if (!controller.signal.aborted) {
          setResource((current) => current.kind === kind && current.id === id ? { ...current, downloaded: true } : current);
          setDownload({ kind, id, busy: false, notice: "Complete resource saved and verified for offline reading.", error: "" });
        }
      }
    } catch (error) { if (!cancelled(error)) setDownload({ kind, id, busy: false, notice: "", error: message(error) }); }
  }
  function chooseDictionary(id: string) { manualDictionary.current = id; setDictionary(id); remember("dictionary", language, id); }
  function chooseTerm(value: string, entry: { dictionary: string; entry: string } | null = null) {
    manualDictionary.current = null; setInput(value); setTerm(value); setExplicitEntry(entry);
    if (!normalizeStudyTerm(value) && !entry) setDictionary(defaultDictionary(dictionaries ?? [], language, [], remembered("dictionary", language)));
  }
  function renderComment(entry: CommentaryEntry, index: number) {
    const coverage = entry.verses ?? [entry.verse];
    return <article className="study-entry" key={`${entry.chapter}/${entry.verse}/${index}`}>
      <h3>{entry.chapter === 0 ? "Book introduction" : entry.verse === 0 ? "Chapter introduction" : `Verse${coverage.length > 1 ? "s" : ""} ${coverage.join(", ")}`}</h3>
      <CitationText text={entry.text} references={entry.references} onReference={onReference} />
    </article>;
  }
  const comments = commentaryReady ? commentsForVerse(commentaryResult.chapter?.entries ?? [], wholeChapter ? undefined : verse) : [];
  const chapterIntroductions = comments.filter((entry) => entry.verse === 0);
  const verseComments = comments.filter((entry) => entry.verse !== 0);

  return <div className="study-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={root} className="study-modal" role="dialog" aria-modal="true" aria-labelledby="study-panel-title">
      <header className="study-modal-header"><div><h2 id="study-panel-title">Study Scripture</h2><p>{translation.toUpperCase()} · Chapter {chapter}{verse === undefined ? "" : ` · Verse ${verse}`}</p></div><button type="button" className="study-close" aria-label="Close study resources" onClick={onClose}>×</button></header>
      {word ? <div className="study-selected-word"><span>{word}</span><button type="button" onClick={() => onSearch(word)}>Search selection</button></div> : null}
      <div className="study-resource-tabs" role="tablist" aria-label="Study resources">{(["dictionary", "commentary"] as const).map((kind) => <button type="button" role="tab" key={kind} id={`study-tab-${kind}`} aria-selected={tab === kind} aria-controls={`study-tabpanel-${kind}`} tabIndex={tab === kind ? 0 : -1} onClick={() => setTab(kind)} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "dictionary" : event.key === "End" ? "commentary" : tab === "dictionary" ? "commentary" : "dictionary"; setTab(next); document.getElementById(`study-tab-${next}`)?.focus(); } }}>{kind === "dictionary" ? "Dictionaries" : "Commentaries"}</button>)}</div>
      <div className="study-modal-body" id={`study-tabpanel-${tab}`} role="tabpanel" aria-labelledby={`study-tab-${tab}`}>
        {catalogErrors[tab] ? <div className="study-status study-error" role="alert"><p>{catalogErrors[tab]}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : !(tab === "dictionary" ? dictionaries : commentaries) ? <p className="study-status" role="status">Loading available {tab === "dictionary" ? "dictionaries" : "commentaries"}…</p> : <>
          {(tab === "dictionary" ? dictionaryChoices?.length : commentaries?.length) ? <label className="study-field"><span>{tab === "dictionary" ? browsing ? "Browse dictionaries" : `Dictionaries with definitions (${dictionaryChoices?.length})` : "Commentary"}</span><select value={selected} onChange={(event) => tab === "dictionary" ? chooseDictionary(event.target.value) : (setCommentary(event.target.value), remember("commentary", language, event.target.value))}>{(tab === "dictionary" ? dictionaryChoices : commentaries)?.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.language})</option>)}</select></label> : null}
            {tab === "dictionary" ? <>
              <form className="study-term-form" onSubmit={(event) => { event.preventDefault(); chooseTerm(input); }}><label><span className="sr-only">Dictionary word or Strong’s number</span><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Word or Strong’s number" autoComplete="off" /></label><button type="submit">Look up</button></form>
              {strong.length ? <div className="study-strong-tokens" aria-label="Original-language entries for this selection">{strong.map((token) => <button type="button" key={token} onClick={() => chooseTerm(token)}>{token}</button>)}</div> : null}
              {browsing ? <p className="study-status">Enter a word or Strong’s number to explore its definitions.</p> : currentLookup?.error ? <div className="study-status study-error" role="alert"><p>{currentLookup.error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : <>
                {!currentLookup?.complete ? <p className="study-status" role="status">{definitions.length ? "Checking other dictionaries…" : `Checking dictionaries for ${term || "this selection"}…`}</p> : null}
                {definitions.map((entry) => <article className="study-entry" key={entry.id}><h3>{entry.key}{entry.occurrence > 1 ? <small> Definition {entry.occurrence}</small> : null}</h3><CitationText text={entry.text} references={entry.references} onReference={onReference} />{entry.see_also?.length ? <div className="study-related"><span>See also</span>{entry.see_also.map((link) => <button type="button" key={link.id} onClick={() => chooseTerm(link.key, { dictionary: entry.dictionary, entry: link.id })}>{link.key}</button>)}</div> : null}</article>)}
                {currentLookup?.complete && !currentLookup.matches.length ? <div className="study-status"><p>{currentLookup.unavailable.length ? "No definition could be confirmed. Some dictionaries are unavailable; try again when connected." : "No exact definition is published for this word or selection."}</p>{currentLookup.suggestions.length ? <div className="study-suggestions"><span>Related entries</span>{currentLookup.suggestions.map(({ dictionary: resource, entry }) => <button type="button" key={`${resource.id}/${entry.id}`} onClick={() => chooseTerm(entry.key, { dictionary: resource.id, entry: entry.id })} title={resource.name}>{entry.key}{entry.occurrence ? ` (${entry.occurrence})` : ""} · {resource.name}</button>)}</div> : null}</div> : null}
                {currentLookup?.unavailable.length ? <div className="study-status"><p>{currentLookup.unavailable.length} {currentLookup.unavailable.length === 1 ? "dictionary is" : "dictionaries are"} unavailable. Showing confirmed definitions.</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Check again</button></div> : null}
              </>}
            </> : !selected ? <p className="study-status">No resources are available.</p> : <>
              {verse !== undefined ? <div className="study-comment-scope"><label><input type="checkbox" checked={wholeChapter} onChange={(event) => setWholeChapter(event.target.checked)} /> Show the whole chapter</label></div> : null}
              {!commentaryReady ? <p className="study-status" role="status">Loading chapter commentary…</p> : commentaryResult.error ? <div className="study-status study-error" role="alert"><p>{commentaryResult.error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : <>
                {commentaryResult.introduction?.entries.length ? <details className="study-introduction"><summary>Book introduction</summary>{commentaryResult.introduction.entries.map(renderComment)}</details> : null}
                {chapterIntroductions.length ? <details className="study-introduction"><summary>Chapter introduction</summary>{chapterIntroductions.map(renderComment)}</details> : null}
                {verseComments.length ? verseComments.map(renderComment) : <p className="study-status">{commentaryResult.chapter ? `No commentary is published for ${wholeChapter ? "this chapter" : `verse ${verse}`}.` : "This commentary does not cover this chapter."}</p>}
              </>}
            </>}
        </>}
      </div>
      {selected && summary ? <footer className="study-resource-footer"><div className="study-download-row"><button type="button" disabled={currentDownload?.busy || !currentResource} onClick={() => void toggleDownload()}>{currentDownload?.busy ? "Saving…" : currentResource?.downloaded ? "Remove offline download" : `Save offline · ${formatSize(summary.bytes)}`}</button>{currentResource?.downloaded ? <span>Available offline</span> : null}</div>{currentDownload?.notice ? <p role="status">{currentDownload.notice}</p> : null}{currentDownload?.error ? <p className="study-error" role="alert">{currentDownload.error}</p> : null}<details className="study-attribution"><summary>{summary.license || "Resource attribution"} · {summary.language}</summary><p>{currentResource?.metadata?.copyright || currentResource?.metadata?.copyright_holder || summary.name}</p>{currentResource?.metadata?.distribution_notes ? <p>{currentResource.metadata.distribution_notes}</p> : null}<p>Source: {currentResource?.metadata?.source || "CrossWire SWORD"}</p></details></footer> : null}
    </section>
  </div>;
}
