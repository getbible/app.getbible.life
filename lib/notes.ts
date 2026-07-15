import type { Passage } from "./getbible";

export interface VerseNote {
  id: string;
  passage: Passage;
  verse: number;
  reference: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export function noteKey(note: Pick<VerseNote, "passage" | "verse">): string {
  return `${note.passage.translation}/${note.passage.book}/${note.passage.chapter}/${note.verse}`;
}

export function compareNotes(left: VerseNote, right: VerseNote): number {
  return left.passage.book - right.passage.book || left.passage.chapter - right.passage.chapter || left.verse - right.verse;
}

export function mergeNotes(current: VerseNote[], imported: VerseNote[]): VerseNote[] {
  const notes = new Map(current.map((note) => [noteKey(note), note]));
  for (const note of imported) {
    const existing = notes.get(noteKey(note));
    if (!existing || note.updatedAt > existing.updatedAt) notes.set(noteKey(note), note);
  }
  return [...notes.values()];
}
