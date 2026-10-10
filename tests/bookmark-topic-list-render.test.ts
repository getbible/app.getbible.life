import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createUiTranslator } from "../lib/i18n.ts";
import type { BookmarkDisplayRow } from "../lib/shared-bookmarks.ts";

// Compile the real component and its preview helpers, sharing React with the
// renderer. CSS is omitted because this suite verifies semantic rendered output.
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../app/components/BookmarkTopicList.tsx", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "empty" },
  plugins: [{
    name: "shared-react-runtime",
    setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    },
  }],
});
const componentUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`;
const { BookmarkTopicRow, BookmarkTopicList } = await import(componentUrl) as typeof import("../app/components/BookmarkTopicList");
type RowProps = ComponentProps<typeof BookmarkTopicRow>;

const row: BookmarkDisplayRow = {
  marking: {
    id: "faith-john-3-16", colorId: "faith", passage: { translation: "kjv", book: 43, chapter: 3 },
    verse: 16, start: null, end: null, quote: "", reference: "John 3:16", createdAt: 1,
  },
  ids: ["faith-john-3-16", "personal-john-3-16"],
  global: true,
  personal: true,
};
const color = { id: "faith", name: "Faith", value: "#e6c663" };
const verse = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";

function props(overrides: Partial<RowProps> = {}): RowProps {
  return { row, color, translation: "kjv", t: createUiTranslator("en"), onOpen() {}, onDelete() {}, ...overrides };
}

function render(overrides: Partial<RowProps> = {}): string {
  return renderToStaticMarkup(createElement(BookmarkTopicRow, props(overrides)));
}

function buttons(html: string): string[] {
  return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

test("a loaded topic row presents the complete verse beneath its reference within one navigation button", () => {
  const html = render({ preview: { text: verse, reference: "John 3:16", direction: "ltr" } });
  const [navigation, deletion] = buttons(html);
  assert.equal(buttons(html).length, 2);
  assert.ok(navigation.indexOf("John 3:16") < navigation.indexOf(verse));
  assert.ok(navigation.indexOf(verse) < navigation.indexOf("Faith"));
  assert.ok(navigation.includes(verse), "the full verse remains present, including its final words");
  assert.match(navigation, /aria-label="Downloaded bookmark">G<\/span>/);
  assert.match(navigation, /personal bookmark also saved/);
  assert.match(deletion, /aria-label="Delete marking for John 3:16"/);
  assert.doesNotMatch(navigation, /delete-marking/);
});

test("selected words retain their original wording and translation instead of displaying the entire verse", () => {
  const selection = { ...row, marking: { ...row.marking, passage: { ...row.marking.passage, translation: "aov" }, start: 4, end: 7, quote: "God" }, global: false };
  const html = render({ row: selection, preview: { text: "Want so lief het God die wêreld gehad", reference: "Johannes 3:16" } });
  const [navigation] = buttons(html);
  assert.match(navigation, /class="bookmark-preview-text"[^>]*>God<\/span>/);
  assert.match(navigation, /Selected text · AOV/);
  assert.match(navigation, /Johannes 3:16/);
  assert.doesNotMatch(navigation, /Want so lief|Downloaded bookmark|Selected text · KJV/);
});

test("loading and failed previews retain usable reference and deletion controls without stale translation text", () => {
  const oldTranslation = { ...row, marking: { ...row.marking, passage: { ...row.marking.passage, translation: "aov" }, quote: "Ou vertaling" } };
  for (const preview of [undefined, { error: true }]) {
    const html = render({ row: oldTranslation, preview });
    const [navigation, deletion] = buttons(html);
    assert.match(navigation, /John 3:16/);
    assert.match(navigation, preview ? /The passage could not be loaded\./ : /Loading passage/);
    assert.match(deletion, /aria-label="Delete marking for John 3:16"/);
    assert.doesNotMatch(html, /\bdisabled(?:=|\s|>)/);
    assert.doesNotMatch(html, /Ou vertaling/);
  }
});

test("preview and reference text are escaped safely while preserving right-to-left verse direction", () => {
  const html = render({ preview: { text: 'בְּרֵאשִׁית <script>alert("x")</script> & words', reference: "Genesis <1>:1", direction: "rtl" } });
  assert.match(html, /dir="rtl"/);
  assert.match(html, /בְּרֵאשִׁית &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; words/);
  assert.match(html, /<bdi>Genesis &lt;1&gt;:1<\/bdi>/);
  assert.doesNotMatch(html, /<script>|<1>/);
});

test("navigation opens the original marking and deletion separately removes its complete displayed membership group", () => {
  const opened: unknown[] = [];
  const deleted: unknown[] = [];
  const element = BookmarkTopicRow(props({ onOpen: value => opened.push(value), onDelete: value => deleted.push(value) }));
  const actions = (element.props as { children: ReactElement<{ onClick: () => void }>[] }).children;
  actions[0].props.onClick();
  assert.deepEqual(opened, [row.marking]);
  assert.deepEqual(deleted, []);
  actions[1].props.onClick();
  assert.deepEqual(opened, [row.marking]);
  assert.deepEqual(deleted, [row]);
});

test("a topic announces loading once while keeping every reference available", () => {
  const otherRow = { ...row, marking: { ...row.marking, id: "faith-john-3-17", verse: 17, reference: "John 3:17" }, ids: ["faith-john-3-17"] };
  const html = renderToStaticMarkup(createElement(BookmarkTopicList, {
    rows: [row, otherRow], colors: new Map([[color.id, color]]), translation: "kjv", t: createUiTranslator("en"), onOpen() {}, onDelete() {},
  }));
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.equal(buttons(html).length, 4);
  assert.match(html, /John 3:16/);
  assert.match(html, /John 3:17/);
});
