"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Verse } from "../../lib/getbible";
import type { Marking, MarkingColor } from "../../lib/markings";
import type { MatchMode } from "../../lib/search";
import {
  annotationClasses, buildAnnotatedSegments, spanDetails, strongIdentifiers,
  tokenDetails, verseSourceAnnotations, type AnnotatedSegment,
} from "../../lib/annotations";
import { createWordActivation } from "../../lib/word-interactions";
import "./scripture.css";

export interface ScriptureTextProps {
  verse: Verse;
  markings: Marking[];
  colors: Map<string, MarkingColor>;
  search?: { query: string; match: MatchMode; caseSensitive: boolean; locale?: string };
  onWord?: (word: string, start: number, end: number, strong: string[]) => void;
  onReference?: (reference: string) => void;
  enabled?: boolean;
}

/** Place inside the existing .verse-text selection container. */
export function ScriptureText({ verse, markings, colors, search, onWord, enabled = true }: ScriptureTextProps) {
  const [wordActivation] = useState(() => createWordActivation(() => {
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed);
  }));
  useEffect(() => () => wordActivation.cancel(), [wordActivation, verse.chapter, verse.verse, verse.name, verse.text]);
  const segments = buildAnnotatedSegments(verse, markings, search);
  const groups: AnnotatedSegment[][] = [];
  for (const segment of segments) {
    const previous = groups.at(-1);
    if (segment.word && previous?.[0].word?.index === segment.word.index) previous.push(segment);
    else groups.push([segment]);
  }
  return groups.map((group) => {
    const first = group[0];
    const word = first.word;
    const content = group.map((segment) => {
      let part: ReactNode = segment.text;
      if (segment.searched) part = <span className="search-arrival-word">{part}</span>;
      const color = segment.colorId ? colors.get(segment.colorId) : undefined;
      return color
        ? <mark key={segment.start} className="scripture-mark" style={{ "--marking-color": color.value } as CSSProperties}>{part}</mark>
        : <span key={segment.start}>{part}</span>;
    });
    if (!word) return <span key={first.start}>{content}</span>;
    const classes = ["scripture-word", ...(enabled ? annotationClasses(first.spans) : []), ...(onWord ? ["scripture-word-action"] : [])];
    const details = enabled ? [...tokenDetails(first.tokens), ...spanDetails(first.spans)] : [];
    const strong = strongIdentifiers(first.tokens);
    const activate = () => onWord?.(word.text, word.start, word.end, strong);
    return <span
      key={first.start}
      className={classes.join(" ")}
      title={details.length ? details.join("\n") : undefined}
      data-word-start={word.start}
      data-word-end={word.end}
      data-strong={strong.length ? strong.join(" ") : undefined}
      role={onWord ? "button" : undefined}
      tabIndex={onWord ? 0 : undefined}
      aria-label={onWord ? `Study ${word.text}${strong.length ? ` (${strong.join(", ")})` : ""}` : undefined}
      onClick={onWord ? (event) => wordActivation.click(event.detail, activate) : undefined}
      onDoubleClick={onWord ? () => wordActivation.cancel() : undefined}
      onBlur={onWord ? () => wordActivation.cancel() : undefined}
      onKeyDown={onWord ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        wordActivation.keyboard(activate);
      } : undefined}
    >{content}</span>;
  });
}

/** Render after, rather than inside, .verse-text. */
export function VerseAnnotations({ verse, onReference, enabled = true }: Pick<ScriptureTextProps, "verse" | "onReference" | "enabled">) {
  const annotations = enabled ? verseSourceAnnotations(verse) : [];
  if (!annotations.length) return null;
  return <details className="verse-source-notes">
    <summary title="Annotations supplied by this translation">{annotations.length === 1 && annotations[0].label.startsWith("Speaker:") ? annotations[0].label : `Source notes (${annotations.length})`}</summary>
    <ul>{annotations.map((annotation) => <li key={annotation.id}>
      <strong>{annotation.label}</strong>
      {annotation.text ? <p>{annotation.text}</p> : null}
      {annotation.details.length ? <p className="verse-source-details">{annotation.details.join(" · ")}</p> : null}
      {annotation.references.map((reference) => onReference
        ? <button key={reference} type="button" onClick={() => onReference(reference)} aria-label={`Read ${reference}`}>{reference}</button>
        : <span className="verse-source-reference" key={reference}>{reference}</span>)}
    </li>)}</ul>
  </details>;
}
