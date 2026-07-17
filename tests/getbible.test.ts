import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { WEEK_MS, bookMatchesSlug, bookSlug, fresh, getBibleLifeUrl, parsePassage, parsePassagePath, passagePath, passageSearch, resolvedLanguageName, translationLanguage, translationValues, validSha, valuesByNumber } from "../lib/getbible.ts";
import { DEFAULT_MARKING_COLORS, compareMarkings, markedSegments, markingMatchesPassage, mergeColors, mergeMarkings, parseMarkingsBackup, passageKey, translucentColor, wholeVerseMarking, withoutWholeVerseMarking } from "../lib/markings.ts";
import { floatingToolbarPosition } from "../lib/floating-toolbar.ts";
import { DEFAULT_TRANSLATION, dailyDateKey, dailyIsCurrent, parseDailyReference } from "../lib/daily.ts";
import { compareNotes, mergeNotes, noteKey, noteMatchesPassage } from "../lib/notes.ts";
import { boundaryIntent, boundaryTurn, normalizeReadingWidth, readerLayout, readerStorageKeys } from "../lib/reader-state.ts";
import { DARK_PALETTES, LIGHT_PALETTES, READER_FONTS, validPalette } from "../lib/appearance.ts";
import { flattenTranslation, highlightSearchText, SEARCH_ARRIVAL_MS, searchVersePage, searchVersePageAsync, searchVerses } from "../lib/search.ts";
import { chapterMarkdown, chapterMarkdownFilename } from "../lib/markdown.ts";
import { createUiTranslator, ENGLISH_UI_MESSAGES, SUPPORTED_UI_LOCALES, uiLocale } from "../lib/i18n.ts";

const localeMessages = (locale: string): string[] => JSON.parse(readFileSync(new URL(`../public/locales/${locale}.json`, import.meta.url), "utf8"));

test("parses and sanitizes passage URLs",()=>{
  assert.deepEqual(parsePassage("?translation=AOV&book=19&chapter=23"),{translation:"aov",book:19,chapter:23});
  assert.deepEqual(parsePassage("?translation=../../bad&book=-1&chapter=no"),{translation:"kjv",book:43,chapter:3});
});

test("creates stable shareable queries",()=>{
  assert.equal(passageSearch({translation:"kjv",book:43,chapter:3}),"?translation=kjv&book=43&chapter=3");
});

test("creates and parses friendly canonical passage paths", () => {
  assert.equal(passagePath({ translation: "kjv", book: 49, chapter: 5 }, "Ephesians"), "/KJV/Ephesians/5");
  assert.deepEqual(parsePassagePath("/KJV/Ephesians/5"), { translation: "kjv", bookSlug: "Ephesians", chapter: 5 });
  assert.equal(bookSlug("1 John"), "1-John");
  assert.equal(bookMatchesSlug("1 John", "1-john"), true);
  assert.equal(getBibleLifeUrl({ translation: "aov", book: 62, chapter: 3 }, "1 Johannes"), "https://getbible.life/AOV/1%20Johannes/3");
  assert.equal(parsePassagePath("/not/a/passage/5"), null);
});

test("exports a chapter as plain one-verse-per-line Markdown", () => {
  const chapter = {
    translation: "King James Version", abbreviation: "kjv", language: "English", direction: "LTR",
    book_nr: 49, book_name: "Ephesians", chapter: 5, name: "Ephesians 5",
    verses: [
      { chapter: 5, verse: 1, name: "Ephesians 5:1", text: "Be ye therefore followers of God." },
      { chapter: 5, verse: 2, name: "Ephesians 5:2", text: "And walk in love." },
    ],
  };
  assert.equal(chapterMarkdown(chapter), "# Ephesians 5\n\n1. Be ye therefore followers of God.\n2. And walk in love.");
  assert.equal(chapterMarkdown(chapter, { translationName: "King James Version", copyrightNotice: "Public Domain" }), "# Ephesians 5\n\n1. Be ye therefore followers of God.\n2. And walk in love.\n\n---\n**King James Version**\n\n> Public Domain");
  assert.equal(chapterMarkdownFilename(chapter), "Ephesians-5.md");
});

test("sorts numbered API records numerically",()=>{
  assert.deepEqual(valuesByNumber({"10":"ten","2":"two","1":"one"}),["one","two","ten"]);
});

test("sorts translations by language then name",()=>{
  const list=translationValues({b:{translation:"Zulu",abbreviation:"b",language:"English",lang:"en",direction:"LTR",sha:"b"},a:{translation:"Alpha",abbreviation:"a",language:"English",lang:"en",direction:"LTR",sha:"a"},c:{translation:"Beta",abbreviation:"c",language:"Afrikaans",lang:"af",direction:"LTR",sha:"c"}});
  assert.deepEqual(list.map(item=>item.abbreviation),["c","a","b"]);
});

test("resolves and sorts translations with missing language names", () => {
  assert.equal(resolvedLanguageName("", "tpi"), "Tok Pisin");
  assert.equal(resolvedLanguageName(undefined, "tlh"), "Klingon");
  assert.equal(resolvedLanguageName("", "bai"), "BAI");
  const list = translationValues({
    tpi: { translation: "Pisin", abbreviation: "tpi", language: "", lang: "tpi", direction: "LTR", sha: "a" },
    en: { translation: "English Bible", abbreviation: "en", language: "English", lang: "en", direction: "LTR", sha: "b" },
    tlh: { translation: "Klingon Bible", abbreviation: "tlh", language: "", lang: "tlh", direction: "LTR", sha: "c" },
  });
  assert.deepEqual(list.map(translationLanguage), ["English", "Klingon", "Tok Pisin"]);
});

test("validates SHA-1 values and weekly freshness",()=>{
  assert.equal(validSha("edeb04d81d465de30775b3cf9d15d08ea441345d"),true);
  assert.equal(validSha("not-a-sha"),false);
  assert.equal(fresh(1_000,1_000+WEEK_MS-1),true);
  assert.equal(fresh(1_000,1_000+WEEK_MS),false);
});

test("identifies passages and whole-verse markings", () => {
  const passage = { translation: "kjv", book: 43, chapter: 3 };
  const marking = {
    id: "one",
    passage,
    verse: 16,
    start: null,
    end: null,
    quote: "For God so loved the world",
    colorId: "yellow",
    createdAt: 1,
  };

  assert.equal(passageKey(passage), "kjv/43/3");
  assert.equal(markingMatchesPassage(marking, passage), true);
  assert.equal(markingMatchesPassage(marking, { ...passage, translation: "aov" }), true);
  assert.equal(wholeVerseMarking([marking])?.id, "one");
});

test("keeps selected-text markings translation-specific", () => {
  const marking = { id: "word", passage: { translation: "kjv", book: 43, chapter: 3 }, verse: 16, start: 0, end: 3, quote: "For", colorId: "yellow", createdAt: 1 };
  assert.equal(markingMatchesPassage(marking, marking.passage), true);
  assert.equal(markingMatchesPassage(marking, { ...marking.passage, translation: "aov" }), false);
});

test("removes a whole-verse color across translations without removing word highlights", () => {
  const passage = { translation: "kjv", book: 43, chapter: 3 };
  const whole = { id: "whole", passage: { ...passage, translation: "aov" }, verse: 16, start: null, end: null, quote: "Verse", colorId: "yellow", createdAt: 1 };
  const word = { ...whole, id: "word", passage, start: 0, end: 4, quote: "Word" };
  assert.deepEqual(withoutWholeVerseMarking([whole, word], passage, 16).map((marking) => marking.id), ["word"]);
});

test("splits overlapping text markings deterministically", () => {
  const passage = { translation: "kjv", book: 43, chapter: 3 };
  const segments = markedSegments("abcdef", [
    { id: "one", passage, verse: 1, start: 1, end: 4, quote: "bcd", colorId: "yellow", createdAt: 1 },
    { id: "two", passage, verse: 1, start: 3, end: 6, quote: "def", colorId: "blue", createdAt: 2 },
  ]);

  assert.deepEqual(segments.map(({ text, colorId }) => ({ text, colorId })), [
    { text: "a", colorId: null },
    { text: "bc", colorId: "yellow" },
    { text: "d", colorId: "blue" },
    { text: "ef", colorId: "blue" },
  ]);
  assert.equal(translucentColor("#fde68a"), "#fde68a45");
});

test("sorts markings in canonical Bible order", () => {
  const markings = [
    { id: "nt", passage: { translation: "kjv", book: 43, chapter: 3 }, verse: 16, start: null, end: null, quote: "John", colorId: "yellow", createdAt: 1 },
    { id: "ot-later", passage: { translation: "kjv", book: 1, chapter: 2 }, verse: 1, start: null, end: null, quote: "Genesis 2", colorId: "yellow", createdAt: 2 },
    { id: "ot-first", passage: { translation: "kjv", book: 1, chapter: 1 }, verse: 1, start: null, end: null, quote: "Genesis 1", colorId: "yellow", createdAt: 3 },
  ];
  assert.deepEqual(markings.sort(compareMarkings).map((marking) => marking.id), ["ot-first", "ot-later", "nt"]);
});

test("loads the complete deployment marking configuration", () => {
  assert.equal(DEFAULT_MARKING_COLORS.length, 60);
  assert.equal(new Set(DEFAULT_MARKING_COLORS.map((color) => color.id)).size, 60);
  assert.equal(DEFAULT_MARKING_COLORS[0].name, "Adultery");
  assert.equal(DEFAULT_MARKING_COLORS.at(-1)?.name, "Worldly Wisdom");
  assert.ok(DEFAULT_MARKING_COLORS.every((color) => /^#[0-9a-f]{6}$/i.test(color.value)));
});

test("merges imported colors and markings without duplicates", () => {
  const passage = { translation: "kjv", book: 43, chapter: 3 };
  const existing = { id: "same", passage, verse: 16, start: null, end: null, quote: "For God", colorId: "yellow", createdAt: 1 };
  const collision = { id: "same", passage, verse: 17, start: null, end: null, quote: "For God sent", colorId: "blue", createdAt: 2 };
  const merged = mergeMarkings([existing], [existing, collision]);

  assert.equal(merged.length, 2);
  assert.equal(merged[1].id, "same-imported-1");
  assert.deepEqual(mergeColors([{ id: "yellow", name: "Promises", value: "#fde68a" }], [
    { id: "yellow", name: "Duplicate", value: "#ffffff" },
    { id: "blue", name: "Study", value: "#bfdbfe" },
  ]).map((color) => color.id), ["yellow", "blue"]);

  const translatedDuplicate = { ...existing, id: "translated", passage: { ...passage, translation: "aov" }, quote: "Want so lief" };
  assert.equal(mergeMarkings([existing], [translatedDuplicate]).length, 1);
});

test("validates portable markings backups", () => {
  const backup = {
    version: 1 as const,
    exportedAt: "2026-07-15T00:00:00.000Z",
    colors: [{ id: "yellow", name: "Promises", value: "#fde68a" }],
    markings: [{ id: "one", passage: { translation: "kjv", book: 1, chapter: 1 }, verse: 1, start: null, end: null, quote: "In the beginning", colorId: "yellow", createdAt: 1 }],
  };
  assert.deepEqual(parseMarkingsBackup(backup), backup);
  assert.throws(() => parseMarkingsBackup({ version: 3, colors: [], markings: [] }), /unsupported format/);
  assert.throws(() => parseMarkingsBackup({ version: 1, colors: [{ id: "x", name: "Bad", value: "red" }], markings: [] }), /invalid data/);
});

test("parses and date-checks daily Scripture responses", () => {
  const daily = parseDailyReference({
    date: "Wednesday 15-July, 2026",
    getbible: "https://getbible.life/kjv/John/3/16",
  });
  assert.deepEqual(daily, { date: "Wednesday 15-July, 2026", translation: "kjv", bookName: "John", chapter: 3, verse: 16 });
  assert.equal(dailyDateKey(daily.date), "2026-07-15");
  assert.equal(dailyIsCurrent(daily.date, new Date(2026, 6, 15, 12)), true);
  assert.equal(dailyIsCurrent(daily.date, new Date(2026, 6, 16, 12)), false);
  assert.equal(DEFAULT_TRANSLATION, "kjv");
});

test("merges verse notes by reference and keeps the newest edit", () => {
  const passage = { translation: "kjv", book: 43, chapter: 3 };
  const old = { id: "one", passage, verse: 16, reference: "John 3:16", text: "Old", createdAt: 1, updatedAt: 2 };
  const fresh = { ...old, id: "two", text: "Fresh", updatedAt: 3 };
  const other = { ...old, id: "three", verse: 17, reference: "John 3:17" };
  const merged = mergeNotes([old], [fresh, other]).sort(compareNotes);
  assert.equal(noteKey(old), "43/3/16");
  assert.equal(noteKey({ ...old, passage: { ...passage, translation: "aov" } }), "43/3/16");
  assert.equal(noteMatchesPassage(old, { ...passage, translation: "aov" }), true);
  assert.deepEqual(merged.map((note) => note.text), ["Fresh", "Old"]);
});

test("changes chapters only when scrolling outward at a reading boundary", () => {
  assert.equal(boundaryTurn(100, 1_200, 800, 2_000), 1);
  assert.equal(boundaryTurn(-100, 0, 800, 2_000), -1);
  assert.equal(boundaryTurn(100, 500, 800, 2_000), 0);
  assert.equal(boundaryTurn(-100, 500, 800, 2_000), 0);
});

test("requires a separate second wheel or touch gesture at a boundary", () => {
  const first = boundaryIntent(null, 1, 1_000);
  assert.equal(first.turn, 0);
  assert.equal(boundaryIntent(first.intent, 1, 1_100).turn, 0);
  assert.equal(boundaryIntent(first.intent, 1, 1_500).turn, 1);
  assert.equal(boundaryIntent(first.intent, -1, 1_500).turn, 0);
});

test("searches a complete translation with word, phrase, case, and scope filters", () => {
  const corpus = flattenTranslation({
    translation: "Test", abbreviation: "tst", language: "English", lang: "en", direction: "LTR",
    books: [
      { nr: 1, name: "Genesis", chapters: [{ chapter: 1, name: "Genesis 1", verses: [
        { chapter: 1, verse: 1, name: "Genesis 1:1", text: "The woman watches cats jump." },
        { chapter: 1, verse: 2, name: "Genesis 1:2", text: "A man and a cat." },
      ] }] },
      { nr: 40, name: "Matthew", chapters: [{ chapter: 1, name: "Matthew 1", verses: [
        { chapter: 1, verse: 1, name: "Matthew 1:1", text: "The man jumps." },
      ] }] },
    ],
  });
  const options = { words: "all" as const, match: "exact" as const, caseSensitive: false, scope: "all" as const, locale: "en" };
  assert.deepEqual(searchVerses(corpus, "the jumps", options).map((verse) => verse.reference), ["Matthew 1:1"]);
  assert.equal(searchVerses(corpus, "cat", { ...options, words: "any", match: "partial" }).length, 2);
  assert.deepEqual(searchVerses(corpus, "The man", { ...options, words: "phrase", scope: "nt" }).map((verse) => verse.reference), ["Matthew 1:1"]);
  assert.equal(searchVerses(corpus, "the man", { ...options, words: "phrase", caseSensitive: true }).length, 0);
  assert.deepEqual(searchVerses(corpus, "cat", { ...options, scope: "book:1" }).map((verse) => verse.reference), ["Genesis 1:2"]);
});

test("highlights every matching result word without losing punctuation", () => {
  const partial = highlightSearchText("A cat, two cats; CAT.", "cat", { match: "partial", caseSensitive: false, locale: "en" });
  assert.equal(partial.map((part) => part.text).join(""), "A cat, two cats; CAT.");
  assert.deepEqual(partial.filter((part) => part.highlighted).map((part) => part.text), ["cat", "cats", "CAT"]);
  const exact = highlightSearchText("woman and women", "woman", { match: "exact", caseSensitive: false, locale: "en" });
  assert.deepEqual(exact.filter((part) => part.highlighted).map((part) => part.text), ["woman"]);
  assert.equal(SEARCH_ARRIVAL_MS, 7_000);
});

test("returns search results in ordered batches and resumes from its cursor", async () => {
  const corpus = Array.from({ length: 55 }, (_, index) => ({
    book: index < 30 ? 1 : 40,
    bookName: index < 30 ? "Genesis" : "Matthew",
    chapter: 1,
    verse: index + 1,
    reference: `${index < 30 ? "Genesis" : "Matthew"} 1:${index + 1}`,
    text: `King ${index}`,
  }));
  const options = { words: "all" as const, match: "exact" as const, caseSensitive: false, scope: "all" as const, locale: "en" };
  const first = searchVersePage(corpus, "king", options, 0, 20);
  assert.equal(first.results.length, 20);
  assert.equal(first.results[0].reference, "Genesis 1:1");
  const second = await searchVersePageAsync(corpus, "king", options, first.nextCursor, 20);
  assert.equal(second.results.length, 20);
  assert.equal(second.results[0].reference, "Genesis 1:21");
});

test("clears only getBible.Life reader storage keys", () => {
  assert.deepEqual(readerStorageKeys(["unrelated", "getbible-reader:notes:v1", "getbible-reader:last:v1"]), ["getbible-reader:notes:v1", "getbible-reader:last:v1"]);
});

test("normalizes the persistent verse layout preference", () => {
  assert.equal(readerLayout("paragraph"), "paragraph");
  assert.equal(readerLayout("lines"), "lines");
  assert.equal(readerLayout("unexpected"), "lines");
  assert.equal(readerLayout(null), "lines");
});

test("defaults new readers to full width and offers Bible reading fonts", () => {
  assert.equal(normalizeReadingWidth(null), "full");
  assert.equal(normalizeReadingWidth("unexpected"), "full");
  assert.equal(normalizeReadingWidth("page"), "page");
  assert.deepEqual(READER_FONTS.slice(2, 7).map((font) => font.name), ["Baskerville", "Garamond", "Charter", "Cambria", "Times New Roman"]);
});

test("keeps full-width reading edge-to-edge on narrow screens", () => {
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.reading-stage \{\s*padding: 8px clamp\(28px, 3vw, 54px\) 78px;\s*\}[\s\S]*?\.reading-stage\[data-reading-width="full"\] \{\s*padding-inline: 3px;\s*\}/);
});

test("offers stable light and dark reading palettes", () => {
  assert.deepEqual(DARK_PALETTES.map(({ id }) => id), ["black", "brown", "charcoal", "navy"]);
  assert.equal(validPalette(DARK_PALETTES, "brown", "black"), "brown");
  assert.equal(validPalette(DARK_PALETTES, "missing", "black"), "black");
  assert.equal(validPalette(LIGHT_PALETTES, null, "white"), "white");
});

test("provides UI locale packs for every GetBible language identifier", () => {
  assert.equal(SUPPORTED_UI_LOCALES.length, 69);
  const localeIndex: string[] = JSON.parse(readFileSync(new URL("../public/locales/index.json", import.meta.url), "utf8"));
  assert.deepEqual(localeIndex, [...SUPPORTED_UI_LOCALES]);
  const messageCount = Object.keys(ENGLISH_UI_MESSAGES).length;
  for (const locale of localeIndex) assert.equal(localeMessages(locale).length, messageCount, `${locale} message count changed`);
  for (const code of ["af", "ar", "en", "hbo", "ru", "tpi", "zh-Hans", "zh-Hant"]) {
    assert.equal(SUPPORTED_UI_LOCALES.includes(code), true, `${code} locale is missing`);
  }
  assert.equal(uiLocale("enm"), "enm");
  assert.equal(uiLocale("unknown-locale"), "unknown");
});

test("translates interface messages while preserving variables and project names", () => {
  const af = createUiTranslator("af", localeMessages("af"));
  const ru = createUiTranslator("ru", localeMessages("ru"));
  const zh = createUiTranslator("zh-Hant", localeMessages("zh-Hant"));
  assert.equal(af("search"), "Soek");
  assert.notEqual(ru("study"), ENGLISH_UI_MESSAGES.study);
  assert.notEqual(zh("verified"), ENGLISH_UI_MESSAGES.verified);
  assert.match(af("clearAllConfirm"), /getBible\.Life/);
  assert.equal(ru("searchTranslation", { translation: "KJV" }).includes("KJV"), true);
});

test("keeps API scripture and user-created marking names outside UI localization", () => {
  const translate = createUiTranslator("ru", localeMessages("ru"));
  const scripture = { book_name: "John", text: "For God so loved the world" };
  const userGroup = { name: "Promises" };
  assert.deepEqual(scripture, { book_name: "John", text: "For God so loved the world" });
  assert.equal(userGroup.name, "Promises");
  assert.notEqual(translate("search"), "Search");
});

test("positions the selection toolbar above a nearby verse", () => {
  assert.deepEqual(
    floatingToolbarPosition(
      { top: 420, right: 620, bottom: 450, left: 220, width: 400, height: 30 },
      { width: 360, height: 82 },
      { width: 1000, height: 800 },
    ),
    { left: 240, top: 326, arrowLeft: 180, placement: "above" },
  );
});

test("flips and constrains the selection toolbar at viewport edges", () => {
  assert.deepEqual(
    floatingToolbarPosition(
      { top: 62, right: 40, bottom: 84, left: 8, width: 32, height: 22 },
      { width: 360, height: 82 },
      { width: 390, height: 720 },
    ),
    { left: 10, top: 96, arrowLeft: 18, placement: "below" },
  );
});

test("keeps the selection toolbar clear of the mobile navigation", () => {
  assert.deepEqual(
    floatingToolbarPosition(
      { top: 500, right: 250, bottom: 530, left: 150, width: 100, height: 30 },
      { width: 300, height: 100 },
      { width: 390, height: 680 },
      { bottomInset: 58 },
    ),
    { left: 50, top: 388, arrowLeft: 150, placement: "above" },
  );
});
