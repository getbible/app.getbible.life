"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Book,
  type Chapter,
  type ChapterInfo,
  type Passage,
  type Translation,
  parsePassage,
  passageSearch,
  translationValues,
  valuesByNumber,
} from "../lib/getbible";
import {
  books as loadBooks,
  chapter as loadChapter,
  chapters as loadChapters,
  clearCache,
  translations as loadTranslations,
} from "../lib/cache";
import {
  DEFAULT_MARKING_COLORS,
  type Marking,
  type MarkingColor,
  compareMarkings,
  mergeColors,
  mergeMarkings,
  parseMarkingsBackup,
  markedSegments,
  markingMatchesPassage,
  translucentColor,
  wholeVerseMarking,
  withoutWholeVerseMarking,
} from "../lib/markings";
import { DAILY_SCRIPTURE_URL, DEFAULT_TRANSLATION, dailyIsCurrent, parseDailyReference } from "../lib/daily";
import { type VerseNote, compareNotes, mergeNotes, noteKey, noteMatchesPassage } from "../lib/notes";
import { boundaryTurn, readerStorageKeys } from "../lib/reader-state";

const LAST_PASSAGE = "getbible-reader:last:v1";
const THEME = "getbible-reader:theme:v1";
const TEXT_SIZE = "getbible-reader:size:v1";
const MARKINGS = "getbible-reader:markings:v1";
const MARKING_COLORS = "getbible-reader:marking-colors:v1";
const ACTIVE_COLOR = "getbible-reader:active-color:v1";
const READER_FONT = "getbible-reader:font:v1";
const LIGHT_PALETTE = "getbible-reader:light-palette:v1";
const READING_WIDTH = "getbible-reader:reading-width:v1";
const NOTES = "getbible-reader:notes:v1";
const LAST_READING = "getbible-reader:last-reading:v1";
const DAILY_CACHE = "getbible-reader:daily:v1";
const INITIAL_PASSAGE: Passage = { translation: "kjv", book: 43, chapter: 3 };

type Drawer = "reader" | "markings" | null;
type StudyTab = "markings" | "notes";

interface TextSelection {
  verse: number;
  start: number;
  end: number;
  text: string;
  reference: string;
}

interface WholeVerseSelection {
  verse: number;
  text: string;
  reference: string;
}

const READER_FONTS = [
  { id: "serif", name: "Classic serif" },
  { id: "book", name: "Book serif" },
  { id: "sans", name: "Clean sans" },
  { id: "system", name: "System sans" },
];

const LIGHT_PALETTES = [
  { id: "white", name: "Pure white" },
  { id: "paper", name: "Warm paper" },
  { id: "ivory", name: "Soft ivory" },
  { id: "mist", name: "Cool mist" },
];

function storedValue<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function identifier(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function selectionWithin(element: HTMLElement): { start: number; end: number; text: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;

  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return null;

  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const text = range.toString();
  const end = start + text.length;

  return text.trim() && end > start ? { start, end, text } : null;
}

export default function Home() {
  const [route, setRoute] = useState<Passage>(INITIAL_PASSAGE);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [passage, setPassage] = useState<Chapter | null>(null);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(true);
  const [dark, setDark] = useState(false);
  const [textSize, setTextSize] = useState(20);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [markingsReady, setMarkingsReady] = useState(false);
  const [markings, setMarkings] = useState<Marking[]>([]);
  const [colors, setColors] = useState<MarkingColor[]>(DEFAULT_MARKING_COLORS);
  const [activeColorId, setActiveColorId] = useState(DEFAULT_MARKING_COLORS[0].id);
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [wholeVerseSelection, setWholeVerseSelection] = useState<WholeVerseSelection | null>(null);
  const [selectedColorId, setSelectedColorId] = useState<string | null>(null);
  const [readerFont, setReaderFont] = useState("serif");
  const [lightPalette, setLightPalette] = useState("white");
  const [readingWidth, setReadingWidth] = useState<"page" | "full">("page");
  const [colorSearch, setColorSearch] = useState("");
  const [verifiedInfo, setVerifiedInfo] = useState(false);
  const [markingMessage, setMarkingMessage] = useState("");
  const [notes, setNotes] = useState<VerseNote[]>([]);
  const [studyTab, setStudyTab] = useState<StudyTab>("markings");
  const [noteEditor, setNoteEditor] = useState<{ verse: number; reference: string; text: string } | null>(null);
  const [needsDaily, setNeedsDaily] = useState(false);
  const [pendingVerse, setPendingVerse] = useState<number | null>(null);
  const requestId = useRef(0);
  const touchStart = useRef<number | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);
  const boundaryLock = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let next = parsePassage(window.location.search);
      if (!window.location.search) {
        const savedReading = storedValue<{ passage: Passage; verse: number } | null>(LAST_READING, null);
        if (savedReading) {
          next = savedReading.passage;
          setPendingVerse(savedReading.verse);
        } else if (localStorage.getItem(LAST_PASSAGE)) {
          next = storedValue<Passage>(LAST_PASSAGE, INITIAL_PASSAGE);
        } else {
          setNeedsDaily(true);
        }
      }

      const storedColors = storedValue<MarkingColor[]>(
        MARKING_COLORS,
        DEFAULT_MARKING_COLORS,
      );
      const usableColors = storedColors.length ? storedColors : DEFAULT_MARKING_COLORS;
      const savedActive = localStorage.getItem(ACTIVE_COLOR);

      setRoute(next);
      setDark(document.documentElement.dataset.theme === "dark");
      setTextSize(
        Math.min(28, Math.max(16, Number(localStorage.getItem(TEXT_SIZE)) || 20)),
      );
      setMarkings(storedValue<Marking[]>(MARKINGS, []));
      setNotes(mergeNotes([], storedValue<VerseNote[]>(NOTES, [])));
      const savedFont = localStorage.getItem(READER_FONT) ?? "serif";
      const savedPalette = localStorage.getItem(LIGHT_PALETTE) ?? "white";
      setReaderFont(READER_FONTS.some((font) => font.id === savedFont) ? savedFont : "serif");
      setLightPalette(LIGHT_PALETTES.some((palette) => palette.id === savedPalette) ? savedPalette : "white");
      setReadingWidth(localStorage.getItem(READING_WIDTH) === "full" ? "full" : "page");
      document.documentElement.dataset.palette = savedPalette;
      setColors(usableColors);
      setActiveColorId(
        usableColors.some((color) => color.id === savedActive)
          ? (savedActive as string)
          : usableColors[0].id,
      );
      setMarkingsReady(true);
      setReady(true);
      void navigator.storage?.persist?.();
    }, 0);

    const popState = () => setRoute(parsePassage(window.location.search));
    window.addEventListener("popstate", popState);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", popState);
    };
  }, []);

  useEffect(() => {
    if (!markingsReady) return;
    localStorage.setItem(MARKINGS, JSON.stringify(markings));
  }, [markings, markingsReady]);

  useEffect(() => {
    if (!markingsReady) return;
    localStorage.setItem(NOTES, JSON.stringify(notes));
  }, [markingsReady, notes]);

  useEffect(() => {
    if (!markingsReady) return;
    localStorage.setItem(MARKING_COLORS, JSON.stringify(colors));
    localStorage.setItem(ACTIVE_COLOR, activeColorId);
  }, [activeColorId, colors, markingsReady]);

  const go = useCallback((next: Passage, replace = false) => {
    window.history[replace ? "replaceState" : "pushState"](
      {},
      "",
      `${window.location.pathname}${passageSearch(next)}`,
    );
    localStorage.setItem(LAST_PASSAGE, JSON.stringify(next));
    setRoute(next);
  }, []);

  const openDailyVerse = useCallback(async () => {
    try {
      let daily = storedValue<unknown | null>(DAILY_CACHE, null);
      let parsed = daily ? parseDailyReference(daily) : null;
      if (!parsed || !dailyIsCurrent(parsed.date)) {
        const response = await fetch(DAILY_SCRIPTURE_URL, { cache: "no-store" });
        if (!response.ok) throw new Error("Today’s Scripture could not be loaded.");
        daily = await response.json();
        parsed = parseDailyReference(daily);
        localStorage.setItem(DAILY_CACHE, JSON.stringify(daily));
      }
      const allBooks = valuesByNumber((await loadBooks(DEFAULT_TRANSLATION)).data);
      const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
      const book = allBooks.find((item) => normalize(item.name) === normalize(parsed.bookName));
      if (!book) throw new Error(`The daily Scripture book “${parsed.bookName}” is unavailable.`);
      setPendingVerse(parsed.verse);
      go({ translation: DEFAULT_TRANSLATION, book: book.nr, chapter: parsed.chapter });
      setDrawer(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Today’s Scripture could not be opened.");
    }
  }, [go]);

  useEffect(() => {
    if (!ready || !needsDaily) return;
    const timer = window.setTimeout(() => {
      setNeedsDaily(false);
      void openDailyVerse();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [needsDaily, openDailyVerse, ready]);

  useEffect(() => {
    if (!ready) return;
    const activeRequest = ++requestId.current;
    const loadingTimer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      setTextSelection(null);
    }, 0);

    void (async () => {
      try {
        const translationResult = await loadTranslations();
        const allTranslations = translationValues(translationResult.data);
        const selectedTranslation =
          allTranslations.find((item) => item.abbreviation === route.translation) ??
          allTranslations.find((item) => item.abbreviation === "kjv") ??
          allTranslations[0];
        if (!selectedTranslation) throw new Error("No translations are available.");

        const bookResult = await loadBooks(selectedTranslation.abbreviation);
        const allBooks = valuesByNumber(bookResult.data);
        const selectedBook =
          allBooks.find((item) => item.nr === route.book) ?? allBooks[0];
        if (!selectedBook) throw new Error("This translation has no books.");

        const chapterResult = await loadChapters(
          selectedTranslation.abbreviation,
          selectedBook.nr,
        );
        const allChapters = valuesByNumber(chapterResult.data);
        const selectedChapter =
          allChapters.find((item) => item.chapter === route.chapter) ??
          allChapters[0];
        if (!selectedChapter) throw new Error("This book has no chapters.");

        const normalized = {
          translation: selectedTranslation.abbreviation,
          book: selectedBook.nr,
          chapter: selectedChapter.chapter,
        };
        if (
          normalized.translation !== route.translation ||
          normalized.book !== route.book ||
          normalized.chapter !== route.chapter
        ) {
          go(normalized, true);
          return;
        }

        const textResult = await loadChapter(
          normalized.translation,
          normalized.book,
          normalized.chapter,
        );
        if (activeRequest !== requestId.current) return;

        setTranslations(allTranslations);
        setTranslation(selectedTranslation);
        setBooks(allBooks);
        setChapters(allChapters);
        setPassage(textResult.data);
        setVerified(textResult.verified);
        document.title = `${textResult.data.name} · getBible.Life`;
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (caught) {
        if (activeRequest === requestId.current) {
          setError(
            caught instanceof Error ? caught.message : "The passage could not be loaded.",
          );
        }
      } finally {
        if (activeRequest === requestId.current) setLoading(false);
      }
    })();

    return () => window.clearTimeout(loadingTimer);
  }, [go, ready, route]);

  useEffect(() => {
    if (!passage || pendingVerse === null) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`v${pendingVerse}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setPendingVerse(null);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [passage, pendingVerse]);

  useEffect(() => {
    if (!passage) return;
    let timer = 0;
    const remember = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const verses = [...document.querySelectorAll<HTMLElement>(".verses > li")];
        const visible = verses.find((element) => element.getBoundingClientRect().bottom > 58) ?? verses.at(-1);
        const verse = Number(visible?.id.replace("v", "")) || 1;
        localStorage.setItem(LAST_READING, JSON.stringify({ passage: route, verse }));
      }, 180);
    };
    remember();
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", remember);
    };
  }, [passage, route]);

  const turn = useCallback(
    async (delta: -1 | 1) => {
      if (!passage) return;
      const chapterIndex = chapters.findIndex(
        (item) => item.chapter === route.chapter,
      );
      const adjacentChapter = chapters[chapterIndex + delta];
      if (adjacentChapter) {
        go({ ...route, chapter: adjacentChapter.chapter });
        return;
      }

      const bookIndex = books.findIndex((item) => item.nr === route.book);
      const adjacentBook = books[bookIndex + delta];
      if (!adjacentBook) return;
      const adjacentChapters = valuesByNumber(
        (await loadChapters(route.translation, adjacentBook.nr)).data,
      );
      const nextChapter = delta === 1 ? adjacentChapters[0] : adjacentChapters.at(-1);
      if (nextChapter) {
        go({ ...route, book: adjacentBook.nr, chapter: nextChapter.chapter });
      }
    },
    [books, chapters, go, passage, route],
  );

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawer(null);
        setTextSelection(null);
        setWholeVerseSelection(null);
      }
      if (event.altKey && event.key === "ArrowLeft") void turn(-1);
      if (event.altKey && event.key === "ArrowRight") void turn(1);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [turn]);

  useEffect(() => {
    boundaryLock.current = false;
    if (drawer || loading || !passage) return;

    const wheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      const root = document.documentElement;
      const direction = boundaryTurn(event.deltaY, window.scrollY, window.innerHeight, root.scrollHeight);
      if (direction && !boundaryLock.current) {
        boundaryLock.current = true;
        void turn(direction);
      }
    };

    window.addEventListener("wheel", wheel, { passive: true });
    return () => window.removeEventListener("wheel", wheel);
  }, [drawer, loading, passage, route, turn]);

  const currentMarkings = useMemo(
    () => markings.filter((marking) => markingMatchesPassage(marking, route)),
    [markings, route],
  );
  const colorMap = useMemo(
    () => new Map(colors.map((color) => [color.id, color])),
    [colors],
  );
  const sortedNotes = useMemo(() => [...notes].sort(compareNotes), [notes]);

  const chapterIndex = chapters.findIndex((item) => item.chapter === route.chapter);
  const bookIndex = books.findIndex((item) => item.nr === route.book);
  const canGoPrevious = chapterIndex > 0 || bookIndex > 0;
  const canGoNext =
    chapterIndex < chapters.length - 1 || bookIndex < books.length - 1;

  const changeTheme = () => {
    const nextDark = !dark;
    setDark(nextDark);
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
    localStorage.setItem(THEME, nextDark ? "dark" : "light");
  };

  const changeTextSize = (value: number) => {
    const next = Math.min(28, Math.max(16, value));
    setTextSize(next);
    localStorage.setItem(TEXT_SIZE, String(next));
  };

  const addMarking = (
    verse: number,
    quote: string,
    reference: string,
    start: number | null,
    end: number | null,
    colorId = activeColorId,
  ) => {
    setMarkings((current) => [
      ...current,
      {
        id: identifier(),
        passage: route,
        verse,
        start,
        end,
        quote,
        reference,
        colorId,
        createdAt: Date.now(),
      },
    ]);
    setActiveColorId(colorId);
        setTextSelection(null);
        setWholeVerseSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const chooseVerseMarking = (verse: number, text: string, reference: string) => {
    setTextSelection(null);
    setWholeVerseSelection({ verse, text, reference });
  };

  const applyWholeVerseMarking = (selection: WholeVerseSelection, colorId: string) => {
    setMarkings((current) => {
      const existingIds = new Set(
        current
          .filter((marking) => markingMatchesPassage(marking, route) && marking.verse === selection.verse && marking.start === null && marking.end === null)
          .map((marking) => marking.id),
      );
      return [
        ...current.filter((marking) => !existingIds.has(marking.id)),
        { id: identifier(), passage: route, verse: selection.verse, start: null, end: null, quote: selection.text, reference: selection.reference, colorId, createdAt: Date.now() },
      ];
    });
    setActiveColorId(colorId);
    setWholeVerseSelection(null);
  };

  const captureSelection = (
    verse: number,
    reference: string,
    event: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    const selected = selectionWithin(event.currentTarget);
    setTextSelection(
      selected ? { verse, reference, ...selected } : null,
    );
  };

  const updateColor = (id: string, changes: Partial<MarkingColor>) => {
    setColors((current) =>
      current.map((color) => (color.id === id ? { ...color, ...changes } : color)),
    );
  };

  const addColor = () => {
    const color = { id: identifier(), name: "New color", value: "#fde68a" };
    setColors((current) => [...current, color]);
    setActiveColorId(color.id);
  };

  const removeColor = (id: string) => {
    if (colors.length === 1) return;
    const color = colors.find((item) => item.id === id);
    const linked = markings.filter((marking) => marking.colorId === id).length;
    if (linked && !window.confirm(`Delete “${color?.name ?? "this color"}” and its ${linked} saved marking${linked === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setColors((current) => current.filter((color) => color.id !== id));
    setMarkings((current) => current.filter((marking) => marking.colorId !== id));
    if (selectedColorId === id) setSelectedColorId(null);
    if (activeColorId === id) setActiveColorId(colors.find((color) => color.id !== id)?.id ?? "");
  };

  const openColorMarkings = (colorId: string) => {
    setSelectedColorId(colorId);
    setDrawer("markings");
  };

  const sortedColorMarkings = useMemo(
    () => markings.filter((marking) => marking.colorId === selectedColorId).sort(compareMarkings),
    [markings, selectedColorId],
  );
  const visibleColors = useMemo(() => {
    const search = colorSearch.trim().toLocaleLowerCase();
    return search ? colors.filter((color) => color.name.toLocaleLowerCase().includes(search)) : colors;
  }, [colorSearch, colors]);

  const exportMarkings = () => {
    const backup = { version: 2, exportedAt: new Date().toISOString(), colors, markings, notes } as const;
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `getBible-Life-markings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMarkingMessage(`Exported ${markings.length} marking${markings.length === 1 ? "" : "s"} and ${notes.length} note${notes.length === 1 ? "" : "s"}.`);
  };

  const importMarkings = async (file: File) => {
    try {
      const backup = parseMarkingsBackup(JSON.parse(await file.text()));
      const previousCount = markings.length;
      const nextColors = mergeColors(colors, backup.colors);
      const nextMarkings = mergeMarkings(markings, backup.markings).filter((marking) => nextColors.some((color) => color.id === marking.colorId));
      setColors(nextColors);
      setMarkings(nextMarkings);
      const previousNotes = notes.length;
      const nextNotes = mergeNotes(notes, backup.notes ?? []);
      setNotes(nextNotes);
      setMarkingMessage(`Imported ${nextMarkings.length - previousCount} new marking${nextMarkings.length - previousCount === 1 ? "" : "s"} and ${nextNotes.length - previousNotes} note${nextNotes.length - previousNotes === 1 ? "" : "s"}; existing data was kept.`);
    } catch (caught) {
      setMarkingMessage(caught instanceof Error ? caught.message : "The markings backup could not be imported.");
    }
  };

  const openNote = (verse: number, reference: string) => {
    const existing = notes.find((note) => noteKey(note) === noteKey({ passage: route, verse }));
    setNoteEditor({ verse, reference, text: existing?.text ?? "" });
  };

  const saveNote = () => {
    if (!noteEditor?.text.trim()) return;
    const now = Date.now();
    setNotes((current) => {
      const key = noteKey({ passage: route, verse: noteEditor.verse });
      const existing = current.find((note) => noteKey(note) === key);
      const note: VerseNote = {
        id: existing?.id ?? identifier(),
        passage: route,
        verse: noteEditor.verse,
        reference: noteEditor.reference,
        text: noteEditor.text.trim(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      return [...current.filter((item) => noteKey(item) !== key), note];
    });
    setNoteEditor(null);
  };

  const openSavedNote = (note: VerseNote) => {
    setDrawer(null);
    setPendingVerse(note.verse);
    if (!noteMatchesPassage(note, route)) go({ ...note.passage, translation: route.translation });
  };

  const clearAllLocalData = async () => {
    if (!window.confirm("Clear all local getBible.Life data? This permanently removes your markings, notes, colors, reading position, settings, and cached Bible chapters from this browser.")) return;
    await clearCache();
    readerStorageKeys(Object.keys(localStorage)).forEach((key) => localStorage.removeItem(key));
    setMarkings([]);
    setNotes([]);
    setColors(DEFAULT_MARKING_COLORS);
    setActiveColorId(DEFAULT_MARKING_COLORS[0].id);
    setDrawer(null);
    setNeedsDaily(true);
  };

  const deleteAllMarkings = () => {
    if (!markings.length || !window.confirm(`Delete all ${markings.length} saved markings? Your color groups will remain. This cannot be undone.`)) return;
    setMarkings([]);
    setSelectedColorId(null);
    setMarkingMessage("All markings were deleted.");
  };

  const openMarking = (marking: Marking) => {
    setDrawer(null);
    setPendingVerse(marking.verse);
    if (!markingMatchesPassage(marking, route)) {
      const translation = marking.start === null && marking.end === null ? route.translation : marking.passage.translation;
      go({ ...marking.passage, translation });
    }
  };

  return (
    <main className={drawer ? "drawer-open" : ""}>
      <header className="topbar">
        <button
          className="menu-button"
          type="button"
          aria-label={drawer === "reader" ? "Close Bible navigation" : "Open Bible navigation"}
          aria-expanded={drawer === "reader"}
          onClick={() => setDrawer(drawer === "reader" ? null : "reader")}
        >
          <span />
          <span />
          <span />
        </button>
        <button className="brand" type="button" title="Open today’s Scripture" onClick={() => void openDailyVerse()}>getBible.Life</button>
        <span className="top-reference">{passage?.name ?? "Opening Bible"}</span>
        <nav className="compact-navigation" aria-label="Chapter navigation">
          <button
            type="button"
            disabled={!canGoPrevious}
            aria-label="Previous chapter"
            onClick={() => void turn(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            disabled={!canGoNext}
            aria-label="Next chapter"
            onClick={() => void turn(1)}
          >
            ›
          </button>
        </nav>
        <button
          className="markings-button"
          type="button"
          aria-expanded={drawer === "markings"}
          onClick={() => setDrawer(drawer === "markings" ? null : "markings")}
        >
          Study
        </button>
        <button className="theme-button" type="button" onClick={changeTheme}>
          {dark ? "Light" : "Dark"}
        </button>
      </header>

      <button
        className="drawer-scrim"
        type="button"
        aria-label="Close menu"
        tabIndex={drawer ? 0 : -1}
        onClick={() => setDrawer(null)}
      />

      <aside className={`drawer ${drawer ? "visible" : ""}`} aria-hidden={!drawer}>
        <div className="drawer-header">
          <strong>{drawer === "markings" ? "Study" : "Choose passage"}</strong>
          <button type="button" aria-label="Close menu" onClick={() => setDrawer(null)}>
            ‹
          </button>
        </div>

        {drawer === "reader" ? (
          <div className="drawer-content">
            <label className="field">
              <span>Translation</span>
              <select
                value={route.translation}
                disabled={!translations.length}
                onChange={(event) =>
                  go({ ...route, translation: event.target.value })
                }
              >
                {translations.map((item) => (
                  <option value={item.abbreviation} key={item.abbreviation}>
                    {item.language} · {item.translation}
                  </option>
                ))}
              </select>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Book</span>
                <select
                  value={route.book}
                  disabled={!books.length}
                  onChange={(event) =>
                    go({ ...route, book: Number(event.target.value), chapter: 1 })
                  }
                >
                  {books.map((item) => (
                    <option value={item.nr} key={item.nr}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field chapter-field">
                <span>Chapter</span>
                <select
                  value={route.chapter}
                  disabled={!chapters.length}
                  onChange={(event) =>
                    go({ ...route, chapter: Number(event.target.value) })
                  }
                >
                  {chapters.map((item) => (
                    <option value={item.chapter} key={item.chapter}>
                      {item.chapter}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="chapter-grid" aria-label="Chapters">
              {chapters.map((item) => (
                <button
                  type="button"
                  key={item.chapter}
                  className={item.chapter === route.chapter ? "active" : ""}
                  aria-current={item.chapter === route.chapter ? "page" : undefined}
                  onClick={() => go({ ...route, chapter: item.chapter })}
                >
                  {item.chapter}
                </button>
              ))}
            </div>

            <details className="reader-options">
              <summary>Reader options</summary>
              <label className="field">
                <span>Text size</span>
                <select
                  value={textSize}
                  onChange={(event) => changeTextSize(Number(event.target.value))}
                >
                  {[16, 18, 20, 22, 24, 26, 28].map((size) => (
                    <option value={size} key={size}>
                      {size}px
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Reading font</span>
                <select value={readerFont} onChange={(event) => {
                  setReaderFont(event.target.value);
                  localStorage.setItem(READER_FONT, event.target.value);
                }}>
                  {READER_FONTS.map((font) => <option value={font.id} key={font.id}>{font.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Reading width</span>
                <select value={readingWidth} onChange={(event) => {
                  const value = event.target.value === "full" ? "full" : "page";
                  setReadingWidth(value);
                  localStorage.setItem(READING_WIDTH, value);
                }}>
                  <option value="page">Page</option>
                  <option value="full">Full screen width</option>
                </select>
              </label>
              {!dark ? <label className="field">
                <span>Light appearance</span>
                <select value={lightPalette} onChange={(event) => {
                  setLightPalette(event.target.value);
                  document.documentElement.dataset.palette = event.target.value;
                  localStorage.setItem(LIGHT_PALETTE, event.target.value);
                }}>
                  {LIGHT_PALETTES.map((palette) => <option value={palette.id} key={palette.id}>{palette.name}</option>)}
                </select>
              </label> : null}
              <p className="cache-status">
                {verified ? "Content hash verified" : "Showing saved content"}
              </p>
              <button
                className="plain-action"
                type="button"
                onClick={() => void clearAllLocalData()}
              >
                Clear all local data
              </button>
            </details>
          </div>
        ) : null}

        {drawer === "markings" ? (
          <div className="drawer-content markings-panel">
            <p className="drawer-help">
              Keep long-term markings and verse notes in this browser.
            </p>
            <div className="study-tabs" role="tablist" aria-label="Study tools">
              <button type="button" role="tab" aria-selected={studyTab === "markings"} onClick={() => setStudyTab("markings")}>Markings <span>{markings.length}</span></button>
              <button type="button" role="tab" aria-selected={studyTab === "notes"} onClick={() => setStudyTab("notes")}>Notes <span>{notes.length}</span></button>
            </div>
            <input ref={importInput} className="file-input" type="file" accept="application/json,.json" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importMarkings(file);
              event.target.value = "";
            }} />
            {studyTab === "markings" ? <>
            <h2>Colors</h2>
            {colors.length > 8 ? <label className="color-search">
              <span>Find a color group</span>
              <input type="search" value={colorSearch} placeholder={`Search ${colors.length} groups`} onChange={(event) => setColorSearch(event.target.value)} />
            </label> : null}
            <div className="color-manager scalable">
              {visibleColors.map((color) => (
                <div className="color-row" key={color.id}>
                  <button
                    className={color.id === activeColorId ? "color-swatch active" : "color-swatch"}
                    type="button"
                    style={{ backgroundColor: color.value }}
                    aria-label={`Use ${color.name}`}
                    onClick={() => setActiveColorId(color.id)}
                  />
                  <input
                    aria-label={`${color.name} color`}
                    type="color"
                    value={color.value}
                    onChange={(event) => updateColor(color.id, { value: event.target.value })}
                  />
                  <input
                    aria-label="Color name"
                    type="text"
                    value={color.name}
                    onChange={(event) => updateColor(color.id, { name: event.target.value })}
                  />
                  <button
                    className="remove-color"
                    type="button"
                    disabled={colors.length === 1}
                    aria-label={`Remove ${color.name}`}
                    onClick={() => removeColor(color.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button className="add-color" type="button" onClick={addColor}>
              Add color
            </button>

            <h2>{selectedColorId ? "Saved markings" : "Marking groups"}</h2>
            {!selectedColorId && markings.length ? (
              <div className="marking-groups">
                {visibleColors.map((color) => {
                  const count = markings.filter((marking) => marking.colorId === color.id).length;
                  return <button type="button" key={color.id} onClick={() => setSelectedColorId(color.id)}>
                    <span className="marking-dot" style={{ backgroundColor: color.value }} />
                    <span><strong>{color.name}</strong><small>{count} marking{count === 1 ? "" : "s"}</small></span>
                    <b>›</b>
                  </button>;
                })}
              </div>
            ) : selectedColorId ? <>
              <button className="back-to-groups" type="button" onClick={() => setSelectedColorId(null)}>‹ All marking groups</button>
              <div className="selected-group-title">
                <span className="marking-dot" style={{ backgroundColor: colorMap.get(selectedColorId)?.value }} />
                <strong>{colorMap.get(selectedColorId)?.name}</strong>
                <small>{sortedColorMarkings.length} marking{sortedColorMarkings.length === 1 ? "" : "s"} · Bible order</small>
              </div>
              {sortedColorMarkings.length ? (
              <ul className="marking-list">
                {sortedColorMarkings.map((marking) => {
                  const color = colorMap.get(marking.colorId);
                  return (
                    <li key={marking.id}>
                      <button
                        className="marking-link"
                        type="button"
                        onClick={() => openMarking(marking)}
                      >
                        <span
                          className="marking-dot"
                          style={{ backgroundColor: color?.value }}
                        />
                        <span>
                          <strong>{marking.reference ?? `Verse ${marking.verse}`}</strong>
                          <small>{marking.quote}</small>
                          <em>{color?.name ?? "Marking"}</em>
                        </span>
                      </button>
                      <button
                        className="delete-marking"
                        type="button"
                        aria-label={`Delete marking for ${marking.reference ?? marking.verse}`}
                        onClick={() =>
                          setMarkings((current) =>
                            current.filter((item) => item.id !== marking.id),
                          )
                        }
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
              ) : <p className="empty-markings">No markings in this group yet.</p>}
            </> : (
              <p className="empty-markings">No markings yet.</p>
            )}

            <section className="backup-section">
              <h2>Backup and reset</h2>
              <div className="marking-actions">
                <button type="button" onClick={exportMarkings} disabled={!markings.length && !notes.length}>Export</button>
                <button type="button" onClick={() => importInput.current?.click()}>Import and merge</button>
                <button className="danger-action" type="button" onClick={deleteAllMarkings} disabled={!markings.length}>Delete all</button>
              </div>
              {markingMessage ? <p className="marking-message" role="status">{markingMessage}</p> : null}
            </section>
            </> : <>
              <h2>Verse notes</h2>
              {sortedNotes.length ? <ul className="note-list">
                {sortedNotes.map((note) => <li key={note.id}>
                  <button type="button" className="note-link" onClick={() => openSavedNote(note)}>
                    <strong>{note.reference}</strong>
                    <span>{note.text}</span>
                  </button>
                  <button type="button" className="edit-note" aria-label={`Edit note for ${note.reference}`} onClick={() => {
                    setDrawer(null);
                    setPendingVerse(note.verse);
                    if (!noteMatchesPassage(note, route)) go({ ...note.passage, translation: route.translation });
                    window.setTimeout(() => setNoteEditor({ verse: note.verse, reference: note.reference, text: note.text }), 100);
                  }}>Edit</button>
                  <button type="button" className="delete-marking" aria-label={`Delete note for ${note.reference}`} onClick={() => {
                    if (window.confirm(`Delete the note for ${note.reference}?`)) setNotes((current) => current.filter((item) => item.id !== note.id));
                  }}>×</button>
                </li>)}
              </ul> : <p className="empty-markings">No verse notes yet. Use “Note” beside any verse to add one.</p>}

              <section className="backup-section">
                <h2>Backup and reset</h2>
                <div className="marking-actions">
                  <button type="button" onClick={exportMarkings} disabled={!markings.length && !notes.length}>Export</button>
                  <button type="button" onClick={() => importInput.current?.click()}>Import and merge</button>
                </div>
                {markingMessage ? <p className="marking-message" role="status">{markingMessage}</p> : null}
              </section>
            </>}
          </div>
        ) : null}
      </aside>

      <section className="reading-stage" data-reading-width={readingWidth}>
        {error ? (
          <div className="state" role="alert">
            <strong>Unable to open this passage</strong>
            <p>{error}</p>
            <button type="button" onClick={() => setRoute({ ...route })}>
              Try again
            </button>
          </div>
        ) : loading || !passage ? (
          <div className="state loading" aria-busy="true">
            <span>Loading passage</span>
            <i />
            <i />
            <i />
            <i />
          </div>
        ) : (
          <article
            className="passage"
            dir={passage.direction.toLowerCase()}
            style={{ "--text-size": `${textSize}px` } as CSSProperties}
            data-reader-font={readerFont}
            onTouchStart={(event) => {
              touchStart.current = event.changedTouches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              if (touchStart.current === null) return;
              const end = event.changedTouches[0]?.clientX ?? touchStart.current;
              const distance = end - touchStart.current;
              touchStart.current = null;
              if (Math.abs(distance) > 70) void turn(distance > 0 ? -1 : 1);
            }}
          >
            <header className="passage-line">
              <strong>{passage.name}</strong>
              <span>{translation?.abbreviation.toUpperCase()}</span>
              <button className="verification-button" type="button" aria-expanded={verifiedInfo} onClick={() => setVerifiedInfo((current) => !current)}>{verified ? "verified" : "saved"}</button>
            </header>
            {verifiedInfo ? <div className="verification-info" role="note">
              {verified ? "Verified means this chapter’s hash is in sync with the CrossWire source modules used by the GetBible API." : "Saved means this chapter is being shown from your browser cache and could not currently be checked against the CrossWire source modules."}
              <button type="button" aria-label="Close verification explanation" onClick={() => setVerifiedInfo(false)}>×</button>
            </div> : null}

            <ol className="verses">
              {passage.verses.map((verse) => {
                const verseMarkings = currentMarkings.filter(
                  (marking) => marking.verse === verse.verse,
                );
                const wholeMarking = wholeVerseMarking(verseMarkings);
                const wholeColor = wholeMarking
                  ? colorMap.get(wholeMarking.colorId)
                  : null;
                const reference = `${passage.book_name} ${passage.chapter}:${verse.verse}`;
                const verseNote = notes.find((note) => noteKey(note) === noteKey({ passage: route, verse: verse.verse }));

                return (
                  <li
                    id={`v${verse.verse}`}
                    key={verse.verse}
                    className={wholeMarking ? "whole-marked" : ""}
                    style={
                      wholeColor
                        ? { backgroundColor: translucentColor(wholeColor.value) }
                        : undefined
                    }
                  >
                    <button
                      className="verse-number"
                      type="button"
                      aria-label={`Choose marking color for ${reference}`}
                      title="Choose a color for this verse"
                      onClick={() => chooseVerseMarking(verse.verse, verse.text, reference)}
                    >
                      {verse.verse}
                    </button>
                    <span
                      className="verse-text"
                      onDoubleClick={() => wholeColor && openColorMarkings(wholeColor.id)}
                      onPointerUp={(event) =>
                        captureSelection(verse.verse, reference, event)
                      }
                    >
                      {markedSegments(verse.text, verseMarkings).map((segment) => {
                        const segmentColor = segment.colorId
                          ? colorMap.get(segment.colorId)
                          : null;
                        return segmentColor ? (
                          <mark
                            key={`${segment.start}-${segment.end}`}
                            style={{ backgroundColor: segmentColor.value }}
                            onDoubleClick={() => openColorMarkings(segmentColor.id)}
                            title={`Double-click to view all ${segmentColor.name} markings`}
                          >
                            {segment.text}
                          </mark>
                        ) : (
                          <span key={`${segment.start}-${segment.end}`}>
                            {segment.text}
                          </span>
                        );
                      })}
                    </span>
                    {verseNote ? <button className="inline-note" type="button" onClick={() => openNote(verse.verse, reference)} aria-label={`Edit note for ${reference}`}>
                      <span>Note</span>
                      <p>{verseNote.text}</p>
                    </button> : null}
                  </li>
                );
              })}
            </ol>

            <footer className="passage-footer">
              <span>{translation?.translation}</span>
              {translation?.distribution_license ? (
                <small>{translation.distribution_license}</small>
              ) : null}
            </footer>
          </article>
        )}
      </section>

      {textSelection || wholeVerseSelection ? (
        <div className="selection-toolbar" role="dialog" aria-label="Mark selected text">
          <span>{textSelection ? `Mark “${textSelection.text.slice(0, 32)}${textSelection.text.length > 32 ? "…" : ""}”` : `Mark ${wholeVerseSelection?.reference}`}</span>
          <div>
            {colors.map((color) => (
              <button
                type="button"
                key={color.id}
                className="selection-color"
                style={{ backgroundColor: color.value }}
                aria-label={`Mark selection as ${color.name}`}
                title={color.name}
                onClick={() =>
                  textSelection ? addMarking(textSelection.verse, textSelection.text, textSelection.reference, textSelection.start, textSelection.end, color.id) : wholeVerseSelection && applyWholeVerseMarking(wholeVerseSelection, color.id)
                }
              />
            ))}
            {wholeVerseSelection ? <button className="selection-none" type="button" aria-label={`Remove whole-verse color from ${wholeVerseSelection.reference}`} title="No whole-verse color" onClick={() => {
              setMarkings((current) => withoutWholeVerseMarking(current, route, wholeVerseSelection.verse));
              setWholeVerseSelection(null);
            }}><i />None</button> : null}
            {wholeVerseSelection ? <button className="add-note-from-palette" type="button" onClick={() => {
              const selection = wholeVerseSelection;
              setWholeVerseSelection(null);
              openNote(selection.verse, selection.reference);
            }}>{notes.some((note) => noteKey(note) === noteKey({ passage: route, verse: wholeVerseSelection.verse })) ? "Edit note" : "Add note"}</button> : null}
            <button
              className="cancel-selection"
              type="button"
              aria-label="Cancel marking"
              onClick={() => {
                setTextSelection(null);
                setWholeVerseSelection(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      {noteEditor ? <div className="note-editor" role="dialog" aria-modal="true" aria-label={`Note for ${noteEditor.reference}`}>
        <div className="note-editor-header"><strong>{noteEditor.reference}</strong><button type="button" aria-label="Close note editor" onClick={() => setNoteEditor(null)}>×</button></div>
        <textarea autoFocus value={noteEditor.text} placeholder="Write your note…" onChange={(event) => setNoteEditor({ ...noteEditor, text: event.target.value })} />
        <div className="note-editor-actions">
          {notes.some((note) => noteKey(note) === noteKey({ passage: route, verse: noteEditor.verse })) ? <button className="delete-note" type="button" onClick={() => {
            if (window.confirm(`Delete the note for ${noteEditor.reference}?`)) {
              const key = noteKey({ passage: route, verse: noteEditor.verse });
              setNotes((current) => current.filter((note) => noteKey(note) !== key));
              setNoteEditor(null);
            }
          }}>Delete</button> : null}
          <button type="button" onClick={() => setNoteEditor(null)}>Cancel</button>
          <button className="save-note" type="button" disabled={!noteEditor.text.trim()} onClick={saveNote}>Save note</button>
        </div>
      </div> : null}

      <nav className="mobile-navigation" aria-label="Chapter navigation">
        <button type="button" disabled={!canGoPrevious} onClick={() => void turn(-1)}>
          Previous
        </button>
        <span>{passage?.name ?? "Loading"}</span>
        <button type="button" disabled={!canGoNext} onClick={() => void turn(1)}>
          Next
        </button>
      </nav>
    </main>
  );
}
