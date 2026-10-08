"use client";

import { useEffect, useRef, useState } from "react";
import type { Chapter } from "../../lib/getbible";
import { queryScripture } from "../../lib/scripture-api";
import { useDialog } from "./useDialog";
import "./reader-tools.css";

export function ReferenceModal({ translation, reference, onClose, onOpen }: {
  translation: string; reference: string; onClose: () => void;
  onOpen: (book: number, chapter: number, verse: number) => void;
}) {
  const [retry, setRetry] = useState(0);
  const key = `${translation}/${reference}/${retry}`;
  const [result, setResult] = useState<{ key: string; chapters: Chapter[]; error: string }>({ key: "", chapters: [], error: "" });
  const loading = result.key !== key;
  const root = useRef<HTMLElement>(null);
  useDialog(root, onClose);
  useEffect(() => {
    const controller = new AbortController();
    void queryScripture(translation, reference, controller.signal).then((chapters) => {
      if (!controller.signal.aborted) setResult({ key, chapters, error: "" });
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setResult({ key, chapters: [], error: caught instanceof Error ? caught.message : "Unable to load this reference." });
    });
    return () => controller.abort();
  }, [translation, reference, key]);
  return <div className="reader-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={root} className="reference-modal" role="dialog" aria-modal="true" aria-label={`Scripture: ${reference}`}>
      <header className="reader-tool-header"><div><h2>{reference}</h2><small>{translation.toUpperCase()}</small></div><button type="button" aria-label="Close scripture reference" onClick={onClose}>×</button></header>
      <div className="reference-content" aria-live="polite" aria-busy={loading}>
        {loading ? <p>Loading Scripture…</p> : result.error ? <div role="alert"><p>{result.error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : result.chapters.map((chapter) => <section key={`${chapter.abbreviation}/${chapter.book_nr}/${chapter.chapter}`} dir={chapter.direction?.toLowerCase() === "rtl" ? "rtl" : "ltr"}>
          <h3>{chapter.name || `${chapter.book_name} ${chapter.chapter}`}</h3>
          {chapter.verses.map((verse) => <p key={verse.verse}><sup>{verse.verse}</sup> {verse.text}</p>)}
          <button type="button" onClick={() => onOpen(chapter.book_nr, chapter.chapter, chapter.verses[0]?.verse || 1)}>Read chapter</button>
        </section>)}
      </div>
    </section>
  </div>;
}
