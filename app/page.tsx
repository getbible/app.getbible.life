"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
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
  bookMatchesSlug,
  bookSlug,
  getBibleLifeUrl,
  parsePassage,
  parsePassagePath,
  passagePath,
  passageSearch,
  translationLanguage,
  translationValues,
  valuesByNumber,
} from "../lib/getbible";
import {
  books as loadBooks,
  chapter as loadChapter,
  chapters as loadChapters,
  clearCache,
  fullTranslation as loadFullTranslation,
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
import { boundaryIntent, boundaryTurn, type BoundaryIntent, readerLayout, type ReaderLayout, normalizeReadingWidth, type ReadingWidth, readerStorageKeys } from "../lib/reader-state";
import { DARK_PALETTES, LIGHT_PALETTES, READER_FONTS, validPalette } from "../lib/appearance";
import { flattenTranslation, highlightSearchText, SEARCH_ARRIVAL_MS, searchVersePageAsync, type MatchMode, type SearchScope, type SearchVerse, type WordMode } from "../lib/search";
import { chapterMarkdown, chapterMarkdownFilename } from "../lib/markdown";
import { createUiTranslator, loadUiMessages, uiLocale, type UiMessageKey } from "../lib/i18n";

const LAST_PASSAGE = "getbible-reader:last:v1";
const THEME = "getbible-reader:theme:v1";
const THEME_MODE = "getbible-reader:theme-mode:v1";
const TEXT_SIZE = "getbible-reader:size:v1";
const MARKINGS = "getbible-reader:markings:v1";
const MARKING_COLORS = "getbible-reader:marking-colors:v1";
const ACTIVE_COLOR = "getbible-reader:active-color:v1";
const READER_FONT = "getbible-reader:font:v1";
const LIGHT_PALETTE = "getbible-reader:light-palette:v1";
const DARK_PALETTE = "getbible-reader:dark-palette:v1";
const READING_WIDTH = "getbible-reader:reading-width:v1";
const READER_LAYOUT = "getbible-reader:layout:v1";
const NOTES = "getbible-reader:notes:v1";
const LAST_READING = "getbible-reader:last-reading:v1";
const DAILY_CACHE = "getbible-reader:daily:v1";
const INITIAL_PASSAGE: Passage = { translation: "kjv", book: 43, chapter: 3 };

type Drawer = "reader" | "markings" | null;
type StudyTab = "markings" | "notes";
type InfoModal = "translation" | "sync" | null;

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

interface SearchArrival {
  book: number;
  chapter: number;
  verse: number;
  query: string;
  match: MatchMode;
  caseSensitive: boolean;
  locale?: string;
  token: number;
}

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

function distributionText(value: string | undefined): string {
  return value?.replace(/\\par/g, "\n").replace(/\n{3,}/g, "\n\n").trim() ?? "";
}

function localizedLanguageName(translation: Translation, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(translation.lang) ?? translationLanguage(translation);
  } catch {
    return translationLanguage(translation);
  }
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
  const [pathBookSlug, setPathBookSlug] = useState<string | null>(null);
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
  const [themeMode, setThemeMode] = useState<"system" | "manual">("system");
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
  const [darkPalette, setDarkPalette] = useState("black");
  const [readingWidth, setReadingWidth] = useState<ReadingWidth>("full");
  const [layout, setLayout] = useState<ReaderLayout>("lines");
  const [colorSearch, setColorSearch] = useState("");
  const [verifiedInfo, setVerifiedInfo] = useState(false);
  const [markingMessage, setMarkingMessage] = useState("");
  const [notes, setNotes] = useState<VerseNote[]>([]);
  const [studyTab, setStudyTab] = useState<StudyTab>("markings");
  const [noteEditor, setNoteEditor] = useState<{ verse: number; reference: string; text: string } | null>(null);
  const [needsDaily, setNeedsDaily] = useState(false);
  const [pendingVerse, setPendingVerse] = useState<number | null>(null);
  const [markdownMode, setMarkdownMode] = useState(false);
  const [markdownMessage, setMarkdownMessage] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchWords, setSearchWords] = useState<WordMode>("all");
  const [searchMatch, setSearchMatch] = useState<MatchMode>("exact");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [searchCorpus, setSearchCorpus] = useState<SearchVerse[]>([]);
  const [searchCorpusKey, setSearchCorpusKey] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState<SearchVerse[]>([]);
  const [searchCursor, setSearchCursor] = useState(0);
  const [searchComplete, setSearchComplete] = useState(true);
  const [searchRunning, setSearchRunning] = useState(false);
  const [searchArrival, setSearchArrival] = useState<SearchArrival | null>(null);
  const [infoModal, setInfoModal] = useState<InfoModal>(null);
  const [uiMessages, setUiMessages] = useState<{ locale: string; messages: readonly string[] }>({ locale: "en", messages: [] });
  const requestId = useRef(0);
  const booksRef = useRef<Book[]>([]);
  const searchRequestId = useRef(0);
  const searchScanId = useRef(0);
  const touchStart = useRef<{ x: number; y: number; boundary: -1 | 0 | 1 } | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);
  const boundaryLock = useRef(false);
  const boundaryAttempt = useRef<BoundaryIntent | null>(null);
  const wheelGestureActive = useRef(false);
  const wheelGestureTimer = useRef(0);
  const locale = uiLocale(translation?.lang);
  const t = useMemo(() => createUiTranslator(locale, uiMessages.locale === locale ? uiMessages.messages : []), [locale, uiMessages]);
  const translatorRef = useRef(t);

  const countMessage = (count: number, one: UiMessageKey, many: UiMessageKey) =>
    t(count === 1 ? one : many, { count });
  const rich = (key: UiMessageKey, replacements: Record<string, ReactNode>) =>
    t(key).split(/(\{[a-zA-Z][a-zA-Z0-9]*\})/g).filter(Boolean).map((part, index) => {
      const name = part.match(/^\{(.+)\}$/)?.[1];
      return name && replacements[name] ? <span key={`${name}-${index}`}>{replacements[name]}</span> : part;
    });

  useEffect(() => {
    translatorRef.current = t;
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const friendly = parsePassagePath(window.location.pathname);
      let next = friendly ? { translation: friendly.translation, book: INITIAL_PASSAGE.book, chapter: friendly.chapter } : parsePassage(window.location.search);
      setPathBookSlug(friendly?.bookSlug ?? null);
      if (!friendly && !window.location.search) {
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
      setThemeMode((localStorage.getItem(THEME_MODE) ?? (localStorage.getItem(THEME) ? "manual" : "system")) === "manual" ? "manual" : "system");
      setTextSize(
        Math.min(28, Math.max(16, Number(localStorage.getItem(TEXT_SIZE)) || 20)),
      );
      setMarkings(storedValue<Marking[]>(MARKINGS, []));
      setNotes(mergeNotes([], storedValue<VerseNote[]>(NOTES, [])));
      const savedFont = localStorage.getItem(READER_FONT) ?? "serif";
      const savedPalette = localStorage.getItem(LIGHT_PALETTE) ?? "white";
      const savedDarkPalette = localStorage.getItem(DARK_PALETTE) ?? "black";
      setReaderFont(READER_FONTS.some((font) => font.id === savedFont) ? savedFont : "serif");
      setLightPalette(validPalette(LIGHT_PALETTES, savedPalette, "white"));
      setDarkPalette(validPalette(DARK_PALETTES, savedDarkPalette, "black"));
      setReadingWidth(normalizeReadingWidth(localStorage.getItem(READING_WIDTH)));
      setLayout(readerLayout(localStorage.getItem(READER_LAYOUT)));
      document.documentElement.dataset.palette = savedPalette;
      document.documentElement.dataset.darkPalette = savedDarkPalette;
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

    const popState = () => {
      const friendly = parsePassagePath(window.location.pathname);
      setPathBookSlug(friendly?.bookSlug ?? null);
      setRoute(friendly ? { translation: friendly.translation, book: INITIAL_PASSAGE.book, chapter: friendly.chapter } : parsePassage(window.location.search));
      setMarkdownMode(false);
    };
    window.addEventListener("popstate", popState);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", popState);
    };
  }, []);

  useEffect(() => {
    if (themeMode !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) => {
      setDark(event.matches);
      document.documentElement.dataset.theme = event.matches ? "dark" : "light";
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = translation?.direction?.toLowerCase() === "rtl" ? "rtl" : "ltr";
    let active = true;
    void loadUiMessages(locale).then((messages) => {
      if (active) setUiMessages({ locale, messages });
    }).catch((caught) => {
      console.error(caught);
      if (active) setUiMessages({ locale, messages: [] });
    });
    return () => { active = false; };
  }, [locale, translation?.direction]);

  useEffect(() => {
    if (!searchOpen && !infoModal) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [infoModal, searchOpen]);

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

  const go = useCallback((next: Passage, replace = false, requestedBookName?: string | null) => {
    const selectedBookName = requestedBookName === null ? null : requestedBookName ?? booksRef.current.find((book) => book.nr === next.book)?.name;
    const url = selectedBookName ? passagePath(next, selectedBookName) : `/${passageSearch(next)}`;
    window.history[replace ? "replaceState" : "pushState"](
      {},
      "",
      url,
    );
    setPathBookSlug(selectedBookName ? bookSlug(selectedBookName) : null);
    localStorage.setItem(LAST_PASSAGE, JSON.stringify(next));
    setMarkdownMode(false);
    setMarkdownMessage("");
    setRoute(next);
  }, []);

  const openDailyVerse = useCallback(async () => {
    try {
      let daily = storedValue<unknown | null>(DAILY_CACHE, null);
      let parsed = daily ? parseDailyReference(daily) : null;
      if (!parsed || !dailyIsCurrent(parsed.date)) {
        const response = await fetch(DAILY_SCRIPTURE_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(translatorRef.current("todaysScriptureLoadError"));
        daily = await response.json();
        parsed = parseDailyReference(daily);
        localStorage.setItem(DAILY_CACHE, JSON.stringify(daily));
      }
      const allBooks = valuesByNumber((await loadBooks(DEFAULT_TRANSLATION)).data);
      const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
      const book = allBooks.find((item) => normalize(item.name) === normalize(parsed.bookName));
      if (!book) throw new Error(translatorRef.current("todaysScriptureBookUnavailable", { book: parsed.bookName }));
      setPendingVerse(parsed.verse);
      go({ translation: DEFAULT_TRANSLATION, book: book.nr, chapter: parsed.chapter }, false, book.name);
      setDrawer(null);
    } catch (caught) {
      console.error(caught);
      setError(translatorRef.current("todaysScriptureOpenError"));
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
        if (!selectedTranslation) throw new Error(translatorRef.current("noTranslations"));

        const bookResult = await loadBooks(selectedTranslation.abbreviation);
        const allBooks = valuesByNumber(bookResult.data);
        booksRef.current = allBooks;
        const selectedBook =
          (pathBookSlug ? allBooks.find((item) => bookMatchesSlug(item.name, pathBookSlug)) : null) ??
          allBooks.find((item) => item.nr === route.book) ?? allBooks[0];
        if (!selectedBook) throw new Error(translatorRef.current("translationHasNoBooks"));

        const chapterResult = await loadChapters(
          selectedTranslation.abbreviation,
          selectedBook.nr,
        );
        const allChapters = valuesByNumber(chapterResult.data);
        const selectedChapter =
          allChapters.find((item) => item.chapter === route.chapter) ??
          allChapters[0];
        if (!selectedChapter) throw new Error(translatorRef.current("bookHasNoChapters"));

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
          go(normalized, true, selectedBook.name);
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
        window.history.replaceState({}, "", passagePath(normalized, selectedBook.name));
        setPathBookSlug(bookSlug(selectedBook.name));
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (caught) {
        if (activeRequest === requestId.current) {
          console.error(caught);
          setError(translatorRef.current("passageLoadError"));
        }
      } finally {
        if (activeRequest === requestId.current) setLoading(false);
      }
    })();

    return () => window.clearTimeout(loadingTimer);
  }, [go, pathBookSlug, ready, route]);

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
    if (!searchArrival || !passage || passage.book_nr !== searchArrival.book || passage.chapter !== searchArrival.chapter) return;
    const timer = window.setTimeout(() => setSearchArrival(null), SEARCH_ARRIVAL_MS);
    return () => window.clearTimeout(timer);
  }, [passage, searchArrival]);

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
        go({ ...route, book: adjacentBook.nr, chapter: nextChapter.chapter }, false, adjacentBook.name);
      }
    },
    [books, chapters, go, passage, route],
  );

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawer(null);
        setSearchOpen(false);
        setInfoModal(null);
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
    boundaryAttempt.current = null;
    wheelGestureActive.current = false;
    window.clearTimeout(wheelGestureTimer.current);
    if (drawer || searchOpen || infoModal || markdownMode || loading || !passage) return;

    const wheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      const root = document.documentElement;
      const direction = boundaryTurn(event.deltaY, window.scrollY, window.innerHeight, root.scrollHeight);
      if (!direction) {
        boundaryAttempt.current = null;
        return;
      }
      window.clearTimeout(wheelGestureTimer.current);
      wheelGestureTimer.current = window.setTimeout(() => { wheelGestureActive.current = false; }, 180);
      if (wheelGestureActive.current) return;
      wheelGestureActive.current = true;
      const next = boundaryIntent(boundaryAttempt.current, direction, performance.now(), 0, 2200);
      boundaryAttempt.current = next.intent;
      if (next.turn && !boundaryLock.current) {
        boundaryLock.current = true;
        void turn(next.turn);
      }
    };

    window.addEventListener("wheel", wheel, { passive: true });
    return () => {
      window.clearTimeout(wheelGestureTimer.current);
      window.removeEventListener("wheel", wheel);
    };
  }, [drawer, infoModal, loading, markdownMode, passage, route, searchOpen, turn]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!searchOpen || !query || !translation) return;
    const key = `${translation.abbreviation}:${translation.sha}`;
    if (searchCorpusKey === key) return;
    const activeRequest = ++searchRequestId.current;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError("");
      void loadFullTranslation(translation.abbreviation, translation.sha)
        .then((result) => {
          if (activeRequest !== searchRequestId.current) return;
          setSearchCorpus(flattenTranslation(result.data));
          setSearchCorpusKey(key);
        })
        .catch((caught) => {
          if (activeRequest === searchRequestId.current) {
            console.error(caught);
            setSearchError(translatorRef.current("searchInitializationError"));
          }
        })
        .finally(() => {
          if (activeRequest === searchRequestId.current) setSearchLoading(false);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchCorpusKey, searchOpen, searchQuery, translation]);

  const searchNeedsInitialization = Boolean(searchQuery.trim() && translation && searchCorpusKey !== `${translation.abbreviation}:${translation.sha}`);

  useEffect(() => {
    if (!searchQuery.trim() || searchNeedsInitialization || searchLoading || searchError) return;
    const scan = ++searchScanId.current;
    const timer = window.setTimeout(() => {
      setSearchRunning(true);
      void searchVersePageAsync(searchCorpus, searchQuery, {
        words: searchWords,
        match: searchMatch,
        caseSensitive: searchCaseSensitive,
        scope: searchScope,
        locale: translation?.lang,
      }, 0, 20, () => scan !== searchScanId.current).then((page) => {
        if (scan !== searchScanId.current) return;
        setSearchResults(page.results);
        setSearchCursor(page.nextCursor);
        setSearchComplete(page.complete);
        setSearchRunning(false);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [searchCaseSensitive, searchCorpus, searchError, searchLoading, searchMatch, searchNeedsInitialization, searchQuery, searchScope, searchWords, translation?.lang]);

  const loadMoreSearchResults = () => {
    if (searchRunning || searchComplete || searchNeedsInitialization || !searchQuery.trim()) return;
    const scan = ++searchScanId.current;
    setSearchRunning(true);
    window.setTimeout(() => {
      void searchVersePageAsync(searchCorpus, searchQuery, {
        words: searchWords,
        match: searchMatch,
        caseSensitive: searchCaseSensitive,
        scope: searchScope,
        locale: translation?.lang,
      }, searchCursor, 20, () => scan !== searchScanId.current).then((page) => {
        if (scan !== searchScanId.current) return;
        setSearchResults((current) => [...current, ...page.results]);
        setSearchCursor(page.nextCursor);
        setSearchComplete(page.complete);
        setSearchRunning(false);
      });
    }, 0);
  };

  const restartSearch = (value: string) => {
    setSearchQuery(value);
    searchScanId.current += 1;
    setSearchResults([]);
    setSearchCursor(0);
    setSearchComplete(false);
    setSearchRunning(Boolean(value.trim()));
    setSearchError("");
    setSearchOpen(true);
  };

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

  const changeThemeMode = (mode: "system" | "manual") => {
    setThemeMode(mode);
    localStorage.setItem(THEME_MODE, mode);
    const nextDark = mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : localStorage.getItem(THEME) === "dark";
    setDark(nextDark);
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
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

  const applySelectionColor = (colorId: string) => {
    if (textSelection) {
      addMarking(textSelection.verse, textSelection.text, textSelection.reference, textSelection.start, textSelection.end, colorId);
    } else if (wholeVerseSelection) {
      applyWholeVerseMarking(wholeVerseSelection, colorId);
    }
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
    const color = { id: identifier(), name: t("newColor"), value: "#fde68a" };
    setColors((current) => [...current, color]);
    setActiveColorId(color.id);
  };

  const removeColor = (id: string) => {
    if (colors.length === 1) return;
    const color = colors.find((item) => item.id === id);
    const linked = markings.filter((marking) => marking.colorId === id).length;
    if (linked && !window.confirm(t(linked === 1 ? "deleteColorConfirmOne" : "deleteColorConfirm", { name: color?.name ?? t("colorName"), count: linked }))) return;
    setColors((current) => current.filter((color) => color.id !== id));
    setMarkings((current) => current.filter((marking) => marking.colorId !== id));
    if (selectedColorId === id) setSelectedColorId(null);
    if (activeColorId === id) setActiveColorId(colors.find((color) => color.id !== id)?.id ?? "");
  };

  const selectMarkingGroup = (colorId: string) => {
    setSelectedColorId(colorId);
    setActiveColorId(colorId);
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
    setMarkingMessage(t("exportComplete", { markings: markings.length, notes: notes.length }));
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
      setMarkingMessage(t("importComplete", { markings: nextMarkings.length - previousCount, notes: nextNotes.length - previousNotes }));
    } catch (caught) {
      console.error(caught);
      setMarkingMessage(t("backupImportError"));
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
    if (!window.confirm(t("clearAllConfirm"))) return;
    await clearCache();
    readerStorageKeys(Object.keys(localStorage)).forEach((key) => localStorage.removeItem(key));
    setMarkings([]);
    setNotes([]);
    setColors(DEFAULT_MARKING_COLORS);
    setActiveColorId(DEFAULT_MARKING_COLORS[0].id);
    setSearchCorpus([]);
    setSearchCorpusKey("");
    setSearchQuery("");
    setSearchResults([]);
    setSearchOpen(false);
    setDrawer(null);
    setNeedsDaily(true);
  };

  const deleteAllMarkings = () => {
    if (!markings.length || !window.confirm(t("deleteAllMarkingsConfirm", { count: markings.length }))) return;
    setMarkings([]);
    setSelectedColorId(null);
    setMarkingMessage(t("allMarkingsDeleted"));
  };

  const openMarking = (marking: Marking) => {
    setDrawer(null);
    setPendingVerse(marking.verse);
    if (!markingMatchesPassage(marking, route)) {
      const translation = marking.start === null && marking.end === null ? route.translation : marking.passage.translation;
      go({ ...marking.passage, translation });
    }
  };

  const copyMarkdown = async () => {
    if (!passage) return;
    try {
      await navigator.clipboard.writeText(chapterMarkdown(passage, { translationName: translation?.translation, copyrightNotice: translation?.distribution_license }));
      setMarkdownMessage(t("chapterCopied"));
    } catch {
      setMarkdownMessage(t("copyUnavailable"));
    }
  };

  const downloadMarkdown = () => {
    if (!passage) return;
    const url = URL.createObjectURL(new Blob([chapterMarkdown(passage, { translationName: translation?.translation, copyrightNotice: translation?.distribution_license })], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = chapterMarkdownFilename(passage);
    link.click();
    URL.revokeObjectURL(url);
    setMarkdownMessage(t("markdownCreated"));
  };

  const translationFacts: Array<[string, string]> = translation ? [
    [t("language"), `${localizedLanguageName(translation, locale)}${translation.lang ? ` (${translation.lang})` : ""}`],
    [t("encoding"), translation.encoding ?? ""],
    [t("direction"), translation.direction],
    ["LCSH", translation.distribution_lcsh ?? ""],
    [t("distributionAbbreviation"), translation.distribution_abbreviation ?? ""],
    [t("versification"), translation.distribution_versification ?? ""],
    ["SHA", translation.sha],
  ].filter(([, value]) => Boolean(value)) as Array<[string, string]> : [];
  const translationHistory = Object.entries(translation?.distribution_history ?? {})
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  return (
    <main className={drawer ? "drawer-open" : ""}>
      <header className="topbar">
        <button
          className="menu-button"
          type="button"
          aria-label={t(drawer === "reader" ? "closeBibleNavigation" : "openBibleNavigation")}
          aria-expanded={drawer === "reader"}
          onClick={() => setDrawer(drawer === "reader" ? null : "reader")}
        >
          <span />
          <span />
          <span />
        </button>
        <button className="brand" type="button" title={t("openTodaysScripture")} onClick={() => void openDailyVerse()}>getBible.Life</button>
        <label className="header-search">
          <span className="sr-only">{t("searchThisTranslation")}</span>
          <input
            type="search"
            value={searchQuery}
            placeholder={t("search")}
            aria-controls="bible-search"
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => restartSearch(event.target.value)}
          />
        </label>
        <span className="top-reference">{passage?.name ?? t("openingBible")}</span>
        <nav className="compact-navigation" aria-label={t("chapterNavigation")}>
          <button
            type="button"
            disabled={!canGoPrevious}
            aria-label={t("previousChapter")}
            onClick={() => void turn(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            disabled={!canGoNext}
            aria-label={t("nextChapter")}
            onClick={() => void turn(1)}
          >
            ›
          </button>
        </nav>
        <button className="markdown-button" type="button" aria-label={t(markdownMode ? "returnToReader" : "openAsMarkdown")} aria-pressed={markdownMode} onClick={() => { setMarkdownMode((current) => !current); setMarkdownMessage(""); }}>
          <svg viewBox="0 0 24 12" aria-hidden="true"><circle cx="6" cy="6" r="4" /><circle cx="18" cy="6" r="4" /><path d="M10 6h4M2 4 0 2m22 2 2-2" /></svg>
        </button>
        <button
          className="markings-button"
          type="button"
          data-mobile-label={t("study")}
          aria-expanded={drawer === "markings"}
          onClick={() => setDrawer(drawer === "markings" ? null : "markings")}
        >
          {t("study")}
        </button>
        {themeMode === "manual" ? <button className="theme-button" type="button" onClick={changeTheme}>
          {t(dark ? "light" : "dark")}
        </button> : null}
      </header>

      {searchOpen ? <section id="bible-search" className="search-overlay" role="dialog" aria-label={t("searchBible")}>
        <div className="search-heading">
          <div><strong>{t("searchTranslation", { translation: translation?.abbreviation.toUpperCase() ?? "" })}</strong><small>{searchCorpusKey ? t("versesReadyOffline", { count: searchCorpus.length.toLocaleString(locale) }) : t("wholeTranslationCached")}</small></div>
          <button type="button" aria-label={t("closeSearch")} onClick={() => { searchScanId.current += 1; setSearchRunning(false); setSearchOpen(false); }}>×</button>
        </div>
        <label className="search-query">
          <span className="sr-only">{t("searchThisTranslation")}</span>
          <input autoFocus type="search" value={searchQuery} placeholder={t("searchTheBible")} onChange={(event) => restartSearch(event.target.value)} />
        </label>
        <div className="search-filters">
          <label><span>{t("words")}</span><select value={searchWords} onChange={(event) => setSearchWords(event.target.value as WordMode)}>
            <option value="all">{t("allWords")}</option><option value="any">{t("anyWord")}</option><option value="phrase">{t("exactPhrase")}</option>
          </select></label>
          <label><span>{t("match")}</span><select value={searchMatch} onChange={(event) => setSearchMatch(event.target.value as MatchMode)}>
            <option value="exact">{t("exactWord")}</option><option value="partial">{t("partialWord")}</option>
          </select></label>
          <label><span>{t("case")}</span><select value={searchCaseSensitive ? "sensitive" : "insensitive"} onChange={(event) => setSearchCaseSensitive(event.target.value === "sensitive")}>
            <option value="insensitive">{t("insensitive")}</option><option value="sensitive">{t("sensitive")}</option>
          </select></label>
          <label><span>{t("where")}</span><select value={searchScope} onChange={(event) => setSearchScope(event.target.value as SearchScope)}>
            <option value="all">{t("wholeBible")}</option><option value="ot">{t("oldTestament")}</option><option value="nt">{t("newTestament")}</option>
            {books.map((book) => <option key={book.nr} value={`book:${book.nr}`}>{book.name}</option>)}
          </select></label>
        </div>
        <div className="search-results" aria-live="polite" onScroll={(event) => {
          const element = event.currentTarget;
          if (element.scrollHeight - element.scrollTop - element.clientHeight < 180) loadMoreSearchResults();
        }}>
          {!searchQuery.trim() ? <p className="search-prompt">{t("searchPrompt")}</p> : searchError ? <p className="search-error">{searchError}</p> : searchLoading || searchNeedsInitialization ? <div className="search-initializing"><i /><strong>{t("initializingSearch")}</strong><span>{t("downloadingTranslation", { translation: translation?.translation ?? "" })}</span></div> : <>
            <p className="search-count">{countMessage(searchResults.length, "resultLoaded", "resultsLoaded")} · {t(searchComplete ? "endOfResults" : "scrollForMore")}</p>
            {searchResults.length ? <ol>{searchResults.map((result) => <li key={`${result.book}/${result.chapter}/${result.verse}`}><button type="button" onClick={() => {
              setSearchArrival({ book: result.book, chapter: result.chapter, verse: result.verse, query: searchQuery, match: searchMatch, caseSensitive: searchCaseSensitive, locale: translation?.lang, token: Date.now() });
              setPendingVerse(result.verse);
              go({ translation: route.translation, book: result.book, chapter: result.chapter }, false, result.bookName);
              setSearchOpen(false);
            }}><strong>{result.reference}</strong><span>{highlightSearchText(result.text, searchQuery, { match: searchMatch, caseSensitive: searchCaseSensitive, locale: translation?.lang }).map((segment, index) => segment.highlighted ? <mark key={index}>{segment.text}</mark> : segment.text)}</span></button></li>)}</ol> : searchRunning ? <div className="search-more"><i />{t("searching")}</div> : <p className="search-prompt">{t("noSearchResults")}</p>}
            {searchRunning && searchResults.length ? <div className="search-more"><i />{t("loadingMoreResults")}</div> : null}
          </>}
        </div>
      </section> : null}

      {infoModal ? <div className="info-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setInfoModal(null); }}>
        <section className="info-modal" role="dialog" aria-modal="true" aria-label={infoModal === "translation" ? t("translationDetails") : t("howMaintained", { getBible: "getBible" })}>
          <header className="info-modal-header">
            <div>
              <h2>{infoModal === "translation" && translation
                ? `${translation.translation} (${translation.abbreviation.toUpperCase()}${translation.distribution_version ? ` - ${translation.distribution_version}` : ""})`
                : t("howSynchronized", { getBible: "getBible" })}</h2>
              {infoModal === "translation" && translation?.distribution_version_date ? <p>{t("lastUpdated", { date: translation.distribution_version_date })}</p> : null}
            </div>
            <button type="button" aria-label={t("closeInformation")} onClick={() => setInfoModal(null)}>×</button>
          </header>
          <div className="info-modal-body">
            {infoModal === "translation" && translation ? <>
              <dl className="translation-facts">
                {translationFacts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
              {translation.description ? <section><h3>{t("description")}</h3><p>{translation.description}</p></section> : null}
              {translation.distribution_about ? <section><h3>{t("aboutAndContact")}</h3><p className="preserve-lines">{distributionText(translation.distribution_about)}</p></section> : null}
              {translation.distribution_license ? <section><h3>{t("license")}</h3><p>{translation.distribution_license}</p></section> : null}
              {translation.distribution_sourcetype || translation.distribution_source ? <section><h3>{t("source")}</h3>
                {translation.distribution_sourcetype ? <p>{translation.distribution_sourcetype}</p> : null}
                {translation.distribution_source ? <a href={translation.distribution_source} target="_blank" rel="noreferrer">{translation.distribution_source}</a> : null}
              </section> : null}
              {translation.url ? <section><h3>{t("apiResource", { getBible: "getBible" })}</h3><a href={translation.url} target="_blank" rel="noreferrer">{translation.url}</a></section> : null}
              {translationHistory.length ? <section><h3>{t("translationHistory")}</h3><ol className="translation-history">
                {translationHistory.map(([version, description]) => <li key={version}><strong>{version.replace(/^history_/, "")}</strong><span>{description}</span></li>)}
              </ol></section> : null}
            </> : <div className="sync-information">
              <p>{rich("syncParagraph1", { getBible: <a href="https://getbible.life/" target="_blank" rel="noreferrer">getBible</a>, crossWire: <a href="https://wiki.crosswire.org/" target="_blank" rel="noreferrer">CrossWire</a>, modules: <a href="http://www.crosswire.org/sword/modules/ModDisp.jsp?modType=Bibles" target="_blank" rel="noreferrer">{t("modules")}</a> })}</p>
              <p>{rich("syncParagraph2", { getBible: <a href="https://getbible.life/" target="_blank" rel="noreferrer">getBible</a>, crossWire: <a href="https://wiki.crosswire.org/" target="_blank" rel="noreferrer">CrossWire</a>, modules: <a href="http://www.crosswire.org/sword/modules/ModDisp.jsp?modType=Bibles" target="_blank" rel="noreferrer">{t("modules")}</a> })}</p>
              <p>{rich("syncParagraph3", { crossWire: <a href="https://wiki.crosswire.org/" target="_blank" rel="noreferrer">CrossWire</a>, hashRepository: <a href="https://git.vdm.dev/getBible/v2" target="_blank" rel="noreferrer">{t("officialHashRepository")}</a>, bibleApi: <a href="https://api.getbible.net" target="_blank" rel="noreferrer">{t("bibleApi")}</a>, translations: <a href="https://api.getbible.net/v2/translations.json" target="_blank" rel="noreferrer">{t("translationsLabel")}</a> })}</p>
              <p>{rich("syncParagraph4", { bibleApi: <a href="https://api.getbible.net" target="_blank" rel="noreferrer">{t("bibleApi")}</a>, hashValues: <a href="https://getbible.life/docs#mapping-helpers" target="_blank" rel="noreferrer">{t("hashValues")}</a> })}</p>
              <p>{rich("syncParagraph5", { modules: <a href="http://www.crosswire.org/sword/modules/ModDisp.jsp?modType=Bibles" target="_blank" rel="noreferrer">{t("modules")}</a>, crossWire: <a href="https://wiki.crosswire.org/" target="_blank" rel="noreferrer">CrossWire</a> })}</p>
              <p>{rich("syncParagraph6", { crossWire: <a href="https://wiki.crosswire.org/" target="_blank" rel="noreferrer">CrossWire</a>, getBible: <a href="https://wiki.crosswire.org/Frontends:getBible" target="_blank" rel="noreferrer">getBible</a>, modules: <a href="http://www.crosswire.org/sword/modules/ModDisp.jsp?modType=Bibles" target="_blank" rel="noreferrer">{t("modules")}</a> })}</p>
              <p>{rich("syncParagraph7", { supportSystem: <a href="https://git.vdm.dev/getBible/support" target="_blank" rel="noreferrer">{t("supportSystem")}</a> })}</p>
              <p>{rich("syncParagraph8", { getBible: <a href="https://getbible.life/" target="_blank" rel="noreferrer">getBible</a> })}</p>
            </div>}
          </div>
        </section>
      </div> : null}

      <button
        className="drawer-scrim"
        type="button"
        aria-label={t("closeMenu")}
        tabIndex={drawer ? 0 : -1}
        onClick={() => setDrawer(null)}
      />

      <aside className={`drawer ${drawer ? "visible" : ""}`} aria-hidden={!drawer}>
        <div className="drawer-header">
          <strong>{t(drawer === "markings" ? "study" : "choosePassage")}</strong>
          <button type="button" aria-label={t("closeMenu")} onClick={() => setDrawer(null)}>
            ‹
          </button>
        </div>

        {drawer === "reader" ? (
          <div className="drawer-content">
            <label className="field">
              <span>{t("translation")}</span>
              <select
                value={route.translation}
                disabled={!translations.length}
                onChange={(event) =>
                  go({ ...route, translation: event.target.value }, false, null)
                }
              >
                {translations.map((item) => (
                  <option value={item.abbreviation} key={item.abbreviation}>
                    {localizedLanguageName(item, locale)} · {item.translation}
                  </option>
                ))}
              </select>
            </label>
            <div className="field-row">
              <label className="field">
                <span>{t("book")}</span>
                <select
                  value={route.book}
                  disabled={!books.length}
                  onChange={(event) => {
                    const nr = Number(event.target.value);
                    go({ ...route, book: nr, chapter: 1 }, false, books.find((book) => book.nr === nr)?.name);
                  }}
                >
                  {books.map((item) => (
                    <option value={item.nr} key={item.nr}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field chapter-field">
                <span>{t("chapter")}</span>
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

            <div className="chapter-grid" aria-label={t("chapters")}>
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
              <summary>{t("readerOptions")}</summary>
              <label className="field">
                <span>{t("appearanceControl")}</span>
                <select value={themeMode} onChange={(event) => changeThemeMode(event.target.value === "manual" ? "manual" : "system")}>
                  <option value="system">{t("followSystem")}</option>
                  <option value="manual">{t("manual")}</option>
                </select>
              </label>
              <label className="field">
                <span>{t("textSize")}</span>
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
                <span>{t("readingFont")}</span>
                <select value={readerFont} onChange={(event) => {
                  setReaderFont(event.target.value);
                  localStorage.setItem(READER_FONT, event.target.value);
                }}>
                  {READER_FONTS.map((font) => <option value={font.id} key={font.id}>{({ serif: t("classicSerif"), book: t("bookSerif"), sans: t("cleanSans"), system: t("systemSans") } as Record<string, string>)[font.id] ?? font.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>{t("readingWidth")}</span>
                <select value={readingWidth} onChange={(event) => {
                  const value = normalizeReadingWidth(event.target.value);
                  setReadingWidth(value);
                  localStorage.setItem(READING_WIDTH, value);
                }}>
                  <option value="page">{t("page")}</option>
                  <option value="full">{t("fullScreenWidth")}</option>
                </select>
              </label>
              <label className="field">
                <span>{t("verseLayout")}</span>
                <select value={layout} onChange={(event) => {
                  const value = readerLayout(event.target.value);
                  setLayout(value);
                  localStorage.setItem(READER_LAYOUT, value);
                }}>
                  <option value="lines">{t("oneVersePerLine")}</option>
                  <option value="paragraph">{t("continuousParagraph")}</option>
                </select>
              </label>
              <label className="field">
                <span>{t("lightAppearance")}</span>
                <select value={lightPalette} onChange={(event) => {
                  setLightPalette(event.target.value);
                  document.documentElement.dataset.palette = event.target.value;
                  localStorage.setItem(LIGHT_PALETTE, event.target.value);
                }}>
                  {LIGHT_PALETTES.map((palette) => <option value={palette.id} key={palette.id}>{({ white: t("pureWhite"), paper: t("warmPaper"), ivory: t("softIvory"), mist: t("coolMist") } as Record<string, string>)[palette.id] ?? palette.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>{t("darkAppearance")}</span>
                <select value={darkPalette} onChange={(event) => {
                  setDarkPalette(event.target.value);
                  document.documentElement.dataset.darkPalette = event.target.value;
                  localStorage.setItem(DARK_PALETTE, event.target.value);
                }}>
                  {DARK_PALETTES.map((palette) => <option value={palette.id} key={palette.id}>{({ black: t("pureBlack"), brown: t("warmBrown"), charcoal: t("softCharcoal"), navy: t("midnightBlue") } as Record<string, string>)[palette.id] ?? palette.name}</option>)}
                </select>
              </label>
              <p className="cache-status">
                {t(verified ? "contentHashVerified" : "showingSavedContent")}
              </p>
              <button
                className="plain-action"
                type="button"
                onClick={() => void clearAllLocalData()}
              >
                {t("clearAllLocalData")}
              </button>
            </details>
          </div>
        ) : null}

        {drawer === "markings" ? (
          <div className="drawer-content markings-panel">
            <p className="drawer-help">
              {t("studyHelp")}
            </p>
            <div className="study-tabs" role="tablist" aria-label={t("studyTools")}>
              <button type="button" role="tab" aria-selected={studyTab === "markings"} onClick={() => setStudyTab("markings")}>{t("markings")} <span>{markings.length.toLocaleString(locale)}</span></button>
              <button type="button" role="tab" aria-selected={studyTab === "notes"} onClick={() => setStudyTab("notes")}>{t("notes")} <span>{notes.length.toLocaleString(locale)}</span></button>
            </div>
            <input ref={importInput} className="file-input" type="file" accept="application/json,.json" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importMarkings(file);
              event.target.value = "";
            }} />
            {studyTab === "markings" ? <>
            <h2>{t(selectedColorId ? "savedMarkings" : "markingGroups")}</h2>
            {!selectedColorId && colors.length ? <>
              <label className="color-search group-search">
                <span>{t("findMarkingGroup")}</span>
                <input type="search" value={colorSearch} placeholder={t("searchGroups", { count: colors.length.toLocaleString(locale) })} onChange={(event) => setColorSearch(event.target.value)} />
              </label>
              <div className="marking-groups scalable">
                {visibleColors.map((color) => {
                  const count = markings.filter((marking) => marking.colorId === color.id).length;
                  return <button className={color.id === activeColorId ? "active" : ""} type="button" key={color.id} onClick={() => selectMarkingGroup(color.id)}>
                    <span className="marking-dot" style={{ backgroundColor: color.value }} />
                    <span><strong>{color.name}</strong><small>{countMessage(count, "oneMarking", "markingCount")}</small></span>
                    <b>›</b>
                  </button>;
                })}
              </div>
              {!visibleColors.length ? <p className="empty-markings">{t("noMatchingGroups")}</p> : null}
            </> : selectedColorId ? <>
              <button className="back-to-groups" type="button" onClick={() => setSelectedColorId(null)}>‹ {t("allMarkingGroups")}</button>
              <div className="selected-group-title">
                <span className="marking-dot" style={{ backgroundColor: colorMap.get(selectedColorId)?.value }} />
                <strong>{colorMap.get(selectedColorId)?.name}</strong>
                <small>{countMessage(sortedColorMarkings.length, "oneMarking", "markingCount")} · {t("bibleOrder")}</small>
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
                          <strong>{marking.reference ?? t("verseNumber", { verse: marking.verse })}</strong>
                          <small>{marking.quote}</small>
                          <em>{color?.name ?? t("marking")}</em>
                        </span>
                      </button>
                      <button
                        className="delete-marking"
                        type="button"
                        aria-label={t("deleteMarkingFor", { reference: marking.reference ?? marking.verse })}
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
              ) : <p className="empty-markings">{t("noMarkingsInGroup")}</p>}
            </> : (
              <p className="empty-markings">{t("noMarkingsYet")}</p>
            )}

            <details className="color-section">
              <summary>{t("manageGroups")}</summary>
              <div className="color-manager scalable">
                {visibleColors.map((color) => (
                  <div className="color-row" key={color.id}>
                    <button
                      className={color.id === activeColorId ? "color-swatch active" : "color-swatch"}
                      type="button"
                      style={{ backgroundColor: color.value }}
                      aria-label={t("useGroup", { name: color.name })}
                      data-tooltip={t("useGroup", { name: color.name })}
                      onClick={() => setActiveColorId(color.id)}
                    />
                    <input aria-label={t("groupColor", { name: color.name })} type="color" value={color.value} onChange={(event) => updateColor(color.id, { value: event.target.value })} />
                    <input aria-label={t("colorName")} type="text" value={color.name} onChange={(event) => updateColor(color.id, { name: event.target.value })} />
                    <button className="remove-color" type="button" disabled={colors.length === 1} aria-label={t("removeGroup", { name: color.name })} onClick={() => removeColor(color.id)}>×</button>
                  </div>
                ))}
              </div>
              <button className="add-color" type="button" onClick={addColor}>{t("addColor")}</button>
            </details>

            <section className="backup-section">
              <h2>{t("backupAndReset")}</h2>
              <div className="marking-actions">
                <button type="button" onClick={exportMarkings} disabled={!markings.length && !notes.length}>{t("export")}</button>
                <button type="button" onClick={() => importInput.current?.click()}>{t("importAndMerge")}</button>
                <button className="danger-action" type="button" onClick={deleteAllMarkings} disabled={!markings.length}>{t("deleteAll")}</button>
              </div>
              {markingMessage ? <p className="marking-message" role="status">{markingMessage}</p> : null}
            </section>
            </> : <>
              <h2>{t("verseNotes")}</h2>
              {sortedNotes.length ? <ul className="note-list">
                {sortedNotes.map((note) => <li key={note.id}>
                  <button type="button" className="note-link" onClick={() => openSavedNote(note)}>
                    <strong>{note.reference}</strong>
                    <span>{note.text}</span>
                  </button>
                  <button type="button" className="edit-note" aria-label={t("editNoteFor", { reference: note.reference })} onClick={() => {
                    setDrawer(null);
                    setPendingVerse(note.verse);
                    if (!noteMatchesPassage(note, route)) go({ ...note.passage, translation: route.translation });
                    window.setTimeout(() => setNoteEditor({ verse: note.verse, reference: note.reference, text: note.text }), 100);
                  }}>{t("edit")}</button>
                  <button type="button" className="delete-marking" aria-label={t("deleteNoteFor", { reference: note.reference })} onClick={() => {
                    if (window.confirm(t("deleteNoteFor", { reference: note.reference }))) setNotes((current) => current.filter((item) => item.id !== note.id));
                  }}>×</button>
                </li>)}
              </ul> : <p className="empty-markings">{t("noVerseNotes")}</p>}

              <section className="backup-section">
                <h2>{t("backupAndReset")}</h2>
                <div className="marking-actions">
                  <button type="button" onClick={exportMarkings} disabled={!markings.length && !notes.length}>{t("export")}</button>
                  <button type="button" onClick={() => importInput.current?.click()}>{t("importAndMerge")}</button>
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
            <strong>{t("unableToOpen")}</strong>
            <p>{error}</p>
            <button type="button" onClick={() => setRoute({ ...route })}>
              {t("tryAgain")}
            </button>
          </div>
        ) : loading || !passage ? (
          <div className="state loading" aria-busy="true">
            <span>{t("loadingPassage")}</span>
            <i />
            <i />
            <i />
            <i />
          </div>
        ) : markdownMode ? (
          <section className="markdown-view" aria-label={`${passage.name} ${t("markdown")}`}>
            <header>
              <div><strong>{passage.name}</strong><span>{t("oneVersePerLine")}</span></div>
              <div><button type="button" onClick={() => void copyMarkdown()}>{t("copy")}</button><button type="button" onClick={downloadMarkdown}>{t("downloadMarkdown")}</button></div>
            </header>
            <textarea readOnly spellCheck={false} value={chapterMarkdown(passage, { translationName: translation?.translation, copyrightNotice: translation?.distribution_license })} aria-label={`${passage.name} ${t("markdown")}`} />
            {markdownMessage ? <p role="status">{markdownMessage}</p> : null}
          </section>
        ) : (
          <article
            className="passage"
            dir={passage.direction.toLowerCase()}
            style={{ "--text-size": `${textSize}px` } as CSSProperties}
            data-reader-font={readerFont}
            onTouchStart={(event) => {
              const touch = event.changedTouches[0];
              if (!touch) return;
              const root = document.documentElement;
              touchStart.current = {
                x: touch.clientX,
                y: touch.clientY,
                boundary: window.scrollY <= 1 ? -1 : window.innerHeight + window.scrollY >= root.scrollHeight - 2 ? 1 : 0,
              };
            }}
            onTouchEnd={(event) => {
              const start = touchStart.current;
              const touch = event.changedTouches[0];
              touchStart.current = null;
              if (!start || !touch) return;
              const horizontal = touch.clientX - start.x;
              const vertical = touch.clientY - start.y;
              if (Math.abs(horizontal) > 70 && Math.abs(horizontal) > Math.abs(vertical)) {
                void turn(horizontal > 0 ? -1 : 1);
                return;
              }
              const outward = start.boundary === 1 ? vertical < -45 : start.boundary === -1 ? vertical > 45 : false;
              if (!outward || !start.boundary) {
                if (Math.abs(vertical) > 45 && Math.abs(vertical) > Math.abs(horizontal)) {
                  const root = document.documentElement;
                  const reached = window.scrollY <= 1 ? -1 : window.innerHeight + window.scrollY >= root.scrollHeight - 2 ? 1 : 0;
                  if (reached) boundaryAttempt.current = { direction: reached, at: performance.now() };
                }
                return;
              }
              const next = boundaryIntent(boundaryAttempt.current, start.boundary, performance.now(), 0, 2200);
              boundaryAttempt.current = next.intent;
              if (next.turn && !boundaryLock.current) {
                boundaryLock.current = true;
                void turn(next.turn);
              }
            }}
          >
            <header className="passage-line">
              <strong>{passage.name}</strong>
              <span>{translation?.abbreviation.toUpperCase()}</span>
              <button className="verification-button" type="button" aria-expanded={verifiedInfo} onClick={() => setVerifiedInfo((current) => !current)}>{t(verified ? "verified" : "saved")}</button>
            </header>
            {verifiedInfo ? <div className="verification-info" role="note">
              {t(verified ? "verifiedExplanation" : "savedExplanation")}
              <button type="button" aria-label={t("closeVerification")} onClick={() => setVerifiedInfo(false)}>×</button>
            </div> : null}

            <ol className={`verses ${layout === "paragraph" ? "verses-paragraph" : "verses-lines"}`} data-layout={layout}>
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
                const arrival = searchArrival?.book === passage.book_nr && searchArrival.chapter === passage.chapter && searchArrival.verse === verse.verse ? searchArrival : null;

                return (
                  <li
                    id={`v${verse.verse}`}
                    key={verse.verse}
                    className={`${wholeMarking ? "whole-marked " : ""}${arrival ? "search-arrival" : ""}`.trim()}
                    data-search-arrival={arrival?.token}
                    style={
                      wholeColor
                        ? { backgroundColor: translucentColor(wholeColor.value) }
                        : undefined
                    }
                  >
                    <button
                      className="verse-number"
                      type="button"
                      aria-label={t("chooseMarkingFor", { reference })}
                      title={t("chooseColorForVerse")}
                      onClick={() => chooseVerseMarking(verse.verse, verse.text, reference)}
                    >
                      {verse.verse}
                    </button>
                    <span
                      className="verse-text"
                      onPointerUp={(event) =>
                        captureSelection(verse.verse, reference, event)
                      }
                    >
                      {markedSegments(verse.text, verseMarkings).map((segment) => {
                        const segmentColor = segment.colorId
                          ? colorMap.get(segment.colorId)
                          : null;
                        const segmentContent = arrival
                          ? highlightSearchText(segment.text, arrival.query, { match: arrival.match, caseSensitive: arrival.caseSensitive, locale: arrival.locale }).map((part, index) => part.highlighted
                            ? <span className="search-arrival-word" key={`${segment.start}-${index}`}>{part.text}</span>
                            : part.text)
                          : segment.text;
                        return segmentColor ? (
                          <mark
                            key={`${segment.start}-${segment.end}`}
                            style={{ backgroundColor: segmentColor.value }}
                          >
                            {segmentContent}
                          </mark>
                        ) : (
                          <span key={`${segment.start}-${segment.end}`}>
                            {segmentContent}
                          </span>
                        );
                      })}
                    </span>
                    {verseNote ? <button className="inline-note" type="button" onClick={() => openNote(verse.verse, reference)} aria-label={t("editNoteFor", { reference })}>
                      <span>{t("note")}</span>
                      <p>{verseNote.text}</p>
                    </button> : null}
                  </li>
                );
              })}
            </ol>

            <footer className="passage-footer">
              {translation ? <button className="translation-details-button" type="button" aria-haspopup="dialog" onClick={() => setInfoModal("translation")}>
                {translation.translation}
              </button> : null}
            </footer>
          </article>
        )}
      </section>

      {passage ? <footer className="site-footer">
        <span className="site-footer-life"><a href={getBibleLifeUrl(route, passage.book_name)}>getBible.Life</a> <span>{t("wordsOfEternalLife")}</span></span>
        <span className="maintenance-credit">{t("lovinglyMaintainedBy")} <a href="https://wiki.crosswire.org/Frontends:getBible" target="_blank" rel="noreferrer">Vast Development Method</a> <button className="site-footer-heart" type="button" aria-label={t("howLovinglyMaintained", { getBible: "getBible" })} aria-haspopup="dialog" onClick={() => setInfoModal("sync")}>♥</button></span>
      </footer> : null}

      {textSelection || wholeVerseSelection ? (
        <div className="selection-toolbar" role="dialog" aria-label={t("markSelectedText")}>
          <span>{textSelection ? t("markQuote", { quote: `${textSelection.text.slice(0, 32)}${textSelection.text.length > 32 ? "…" : ""}` }) : t("markReference", { reference: wholeVerseSelection?.reference ?? "" })}</span>
          <div>
            {colorMap.get(activeColorId) ? <button className="selection-active-group" type="button" onClick={() => applySelectionColor(activeColorId)}>
              <i style={{ backgroundColor: colorMap.get(activeColorId)?.value }} />
              <span>{colorMap.get(activeColorId)?.name}</span>
            </button> : null}
            <label className="selection-group-picker">
              <span className="sr-only">{t("chooseAnotherGroup")}</span>
              <select value="" onChange={(event) => event.target.value && applySelectionColor(event.target.value)}>
                <option value="" disabled>{t("moreGroups")}</option>
                {colors.filter((color) => color.id !== activeColorId).map((color) => <option value={color.id} key={color.id}>{color.name}</option>)}
              </select>
            </label>
            {wholeVerseSelection ? <button className="selection-none" type="button" aria-label={t("removeWholeVerseColor", { reference: wholeVerseSelection.reference })} title={t("noWholeVerseColor")} onClick={() => {
              setMarkings((current) => withoutWholeVerseMarking(current, route, wholeVerseSelection.verse));
              setWholeVerseSelection(null);
            }}><i />{t("none")}</button> : null}
            {wholeVerseSelection ? <button className="add-note-from-palette" type="button" onClick={() => {
              const selection = wholeVerseSelection;
              setWholeVerseSelection(null);
              openNote(selection.verse, selection.reference);
            }}>{t(notes.some((note) => noteKey(note) === noteKey({ passage: route, verse: wholeVerseSelection.verse })) ? "editNote" : "addNote")}</button> : null}
            <button
              className="cancel-selection"
              type="button"
              aria-label={t("cancelMarking")}
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

      {noteEditor ? <div className="note-editor" role="dialog" aria-modal="true" aria-label={t("noteFor", { reference: noteEditor.reference })}>
        <div className="note-editor-header"><strong>{noteEditor.reference}</strong><button type="button" aria-label={t("closeNoteEditor")} onClick={() => setNoteEditor(null)}>×</button></div>
        <textarea autoFocus value={noteEditor.text} placeholder={t("writeYourNote")} onChange={(event) => setNoteEditor({ ...noteEditor, text: event.target.value })} />
        <div className="note-editor-actions">
          {notes.some((note) => noteKey(note) === noteKey({ passage: route, verse: noteEditor.verse })) ? <button className="delete-note" type="button" onClick={() => {
            if (window.confirm(t("deleteNoteFor", { reference: noteEditor.reference }))) {
              const key = noteKey({ passage: route, verse: noteEditor.verse });
              setNotes((current) => current.filter((note) => noteKey(note) !== key));
              setNoteEditor(null);
            }
          }}>{t("delete")}</button> : null}
          <button type="button" onClick={() => setNoteEditor(null)}>{t("cancel")}</button>
          <button className="save-note" type="button" disabled={!noteEditor.text.trim()} onClick={saveNote}>{t("saveNote")}</button>
        </div>
      </div> : null}

      <nav className="mobile-navigation" aria-label={t("chapterNavigation")}>
        <button type="button" disabled={!canGoPrevious} onClick={() => void turn(-1)}>
          {t("previous")}
        </button>
        <span>{passage?.name ?? t("loading")}</span>
        <button type="button" disabled={!canGoNext} onClick={() => void turn(1)}>
          {t("next")}
        </button>
      </nav>
    </main>
  );
}
