"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Marking, MarkingColor } from "../../lib/markings";
import { coordinateReference } from "../../lib/scripture-api";
import {
  downloadBookmarkCatalog,
  getBookmarkLocale,
  getBookmarkTopic,
  getBookmarkTopics,
  type BookmarkTopic,
  type BookmarkTopicSummary,
} from "../../lib/study-api";
import { bookmarkCoordinates, bookmarkReference, bookmarkTopicMatches, bookmarkTopicName, importBookmarkTopic } from "../../lib/shared-bookmarks";
import { useDialog } from "./useDialog";
import "./shared-bookmarks.css";

export interface SharedBookmarksProps {
  translation: string;
  language: string;
  onImport: (colors: MarkingColor[], markings: Marking[]) => void;
  onReference: (reference: string) => void;
  onOpen: (book: number, chapter: number, verse: number) => void;
  onClose: () => void;
}

const REFERENCE_PAGE_SIZE = 40;
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function SharedBookmarks({ translation, language, onImport, onReference, onOpen, onClose }: SharedBookmarksProps) {
  const root = useRef<HTMLElement>(null);
  useDialog(root, onClose);
  const [topics, setTopics] = useState<BookmarkTopicSummary[]>([]);
  const [localeNames, setLocaleNames] = useState<{ locale: string; topics: Record<string, string> } | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<BookmarkTopic | null>(null);
  const [loading, setLoading] = useState(true);
  const [topicLoading, setTopicLoading] = useState(false);
  const [error, setError] = useState("");
  const [topicError, setTopicError] = useState("");
  const [notice, setNotice] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [referencesShown, setReferencesShown] = useState(REFERENCE_PAGE_SIZE);
  const [retry, setRetry] = useState(0);
  const [topicRetry, setTopicRetry] = useState(0);
  const downloadController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getBookmarkTopics(controller.signal).then((catalog) => {
      if (!controller.signal.aborted) setTopics(catalog.topics);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(caught, "Unable to load shared bookmark topics."));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    const controller = new AbortController();
    const locale = language.trim().toLowerCase().replaceAll("_", "-");
    // A language may have a partial catalog or none; source English names remain
    // available while the locale is fetched and when its resource is absent.
    void getBookmarkLocale(locale, controller.signal).catch(() => {
      if (controller.signal.aborted || !locale.includes("-")) return null;
      return getBookmarkLocale(locale.split("-")[0], controller.signal);
    }).then((catalog) => {
      if (catalog && !controller.signal.aborted) setLocaleNames({ locale, topics: catalog.topics });
    }).catch(() => { /* English is the documented display fallback. */ });
    return () => controller.abort();
  }, [language]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void getBookmarkTopic(selectedId, controller.signal).then((topic) => {
      const verses = bookmarkCoordinates(topic.verses);
      if (!controller.signal.aborted) setSelected({ ...topic, verses });
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setTopicError(errorMessage(caught, "Unable to load this topic."));
    }).finally(() => { if (!controller.signal.aborted) setTopicLoading(false); });
    return () => controller.abort();
  }, [selectedId, topicRetry]);

  useEffect(() => () => downloadController.current?.abort(), []);

  const locale = language.trim().toLowerCase().replaceAll("_", "-");
  const namedTopics = useMemo(() => {
    const names = localeNames?.locale === locale ? localeNames.topics : {};
    return topics.map((topic) => ({ ...topic, names: names[topic.id] ? { [locale]: names[topic.id] } : undefined }));
  }, [topics, localeNames, locale]);
  const visibleTopics = useMemo(() => namedTopics.filter((topic) => bookmarkTopicMatches(topic, filter, language)), [namedTopics, filter, language]);
  const selectedName = selected ? bookmarkTopicName(selected, language) : "";

  async function saveCatalog() {
    if (downloading) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    setNotice("");
    try {
      const catalog = await downloadBookmarkCatalog(controller.signal);
      if (controller.signal.aborted) return;
      setTopics(catalog.topics.map((topic) => ({ ...topic, verses: topic.verses.length })));
      const locale = language.toLowerCase().replaceAll("_", "-");
      setLocaleNames({ locale, topics: (catalog.locales[locale] ?? catalog.locales[locale.split("-")[0]] ?? catalog.locales.en)?.topics ?? {} });
      setDownloaded(true);
      setNotice(`${catalog.topics.length.toLocaleString()} topics saved for offline browsing. Scripture uses your downloaded translations.`);
    } catch (caught) {
      if (!controller.signal.aborted) setNotice(errorMessage(caught, "Unable to save the shared bookmark catalog offline."));
    } finally {
      if (!controller.signal.aborted) setDownloading(false);
      if (downloadController.current === controller) downloadController.current = null;
    }
  }

  function saveTopic() {
    if (!selected) return;
    try {
      const imported = importBookmarkTopic(selected, translation, language);
      onImport(imported.colors, imported.markings);
      setNotice(`${selectedName} saved as a marking group. Existing markings remain available; importing this topic again creates no duplicates.`);
    } catch (caught) {
      setNotice(errorMessage(caught, "Unable to import this topic."));
    }
  }

  return <div className="shared-bookmarks-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={root} className="shared-bookmarks" role="dialog" aria-modal="true" aria-labelledby="shared-bookmarks-title">
      <header className="shared-bookmarks-header">
        <div><h2 id="shared-bookmarks-title">Shared bookmarks</h2><p>Explore topical Scripture collections and add them to your markings.</p></div>
        <button type="button" className="shared-bookmarks-close" aria-label="Close shared bookmarks" onClick={onClose}>×</button>
      </header>
      <div className="shared-bookmarks-toolbar">
        <label><span>Find a topic</span><input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Topic or keyword" /></label>
        <button type="button" disabled={downloading} onClick={() => void saveCatalog()}>{downloading ? "Saving catalog…" : downloaded ? "Refresh offline catalog" : "Save catalog offline"}</button>
      </div>
      {notice ? <p className="shared-bookmarks-notice" role="status">{notice}</p> : null}
      <div className="shared-bookmarks-layout">
        <nav className="shared-bookmarks-topics" aria-label="Shared bookmark topics" aria-busy={loading}>
          {loading ? <p className="shared-bookmarks-empty">Loading topics…</p> : error ? <div className="shared-bookmarks-empty" role="alert"><p>{error}</p><button type="button" onClick={() => { setLoading(true); setError(""); setRetry((value) => value + 1); }}>Try again</button></div> : <>
            <p className="shared-bookmarks-count">{visibleTopics.length.toLocaleString()} {visibleTopics.length === 1 ? "topic" : "topics"}</p>
            <ul>{visibleTopics.map((topic) => <li key={topic.id}><button type="button" aria-pressed={selectedId === topic.id} onClick={() => {
              if (topic.id === selectedId) return;
              setSelected(null); setTopicError(""); setTopicLoading(true); setReferencesShown(REFERENCE_PAGE_SIZE); setSelectedId(topic.id); setNotice("");
            }}>
              <span className="shared-bookmarks-dot" style={{ backgroundColor: /^#[a-f0-9]{6}$/i.test(topic.color) ? topic.color : "var(--muted)" }} />
              <span><strong>{bookmarkTopicName(topic, language)}</strong><small>{topic.verses.toLocaleString()} references</small></span>
            </button></li>)}</ul>
            {!visibleTopics.length ? <p className="shared-bookmarks-empty">No topics match your search.</p> : null}
          </>}
        </nav>
        <div className="shared-bookmarks-detail" aria-busy={topicLoading} aria-live="polite">
          {!selectedId ? <div className="shared-bookmarks-welcome"><h3>Choose a topic</h3><p>Preview its verses in {translation.toUpperCase()} or save the collection as one marking group.</p><p>Public collections use whole verses and work across translations.</p></div> : topicLoading ? <p className="shared-bookmarks-empty">Loading references…</p> : topicError ? <div className="shared-bookmarks-empty" role="alert"><p>{topicError}</p><button type="button" onClick={() => { setTopicLoading(true); setTopicError(""); setTopicRetry((value) => value + 1); }}>Try again</button></div> : selected ? <>
            <div className="shared-bookmarks-topic-heading"><span className="shared-bookmarks-dot" style={{ backgroundColor: selected.color }} /><div><h3>{selectedName}</h3><p>{selected.verses.length.toLocaleString()} Scripture references · {translation.toUpperCase()}</p></div></div>
            <button type="button" className="shared-bookmarks-import" disabled={!selected.verses.length} onClick={saveTopic}>Add topic to my markings</button>
            <p className="shared-bookmarks-help">Preview a verse or continue reading its chapter. Verse availability follows your translation.</p>
            <ol className="shared-bookmarks-references">{selected.verses.slice(0, referencesShown).map((coordinate) => {
              const reference = bookmarkReference(coordinate);
              return <li key={coordinate.join(":")}><button type="button" className="shared-bookmarks-reference" aria-label={`Preview ${reference}`} onClick={() => { onClose(); onReference(coordinateReference(...coordinate)); }}>{reference}</button><button type="button" className="shared-bookmarks-read" aria-label={`Read ${reference} in its chapter`} onClick={() => { onClose(); onOpen(...coordinate); }}>Read chapter</button></li>;
            })}</ol>
            {referencesShown < selected.verses.length ? <button type="button" className="shared-bookmarks-more" onClick={() => setReferencesShown((value) => value + REFERENCE_PAGE_SIZE)}>Show more references ({(selected.verses.length - referencesShown).toLocaleString()} remaining)</button> : null}
            {!selected.verses.length ? <p className="shared-bookmarks-empty">This topic has no published references yet.</p> : null}
          </> : null}
        </div>
      </div>
    </section>
  </div>;
}
