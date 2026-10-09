import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BookmarkMenuProps } from "../app/components/BookmarkMenu";
import { createUiTranslator } from "../lib/i18n.ts";

// Exercise the actual component with the existing Vite compiler. Only CSS is
// omitted; use the same React instance as the renderer so hooks run normally.
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../app/components/BookmarkMenu.tsx", import.meta.url))],
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
const { BookmarkMenu } = await import(componentUrl) as typeof import("../app/components/BookmarkMenu");

const colors = [
  { id: "faith", name: "Faith", value: "#e6c663" },
  { id: "hope", name: "Hope", value: "#5ed497" },
  { id: "love", name: "Love", value: "#de6d86" },
];

function render(overrides: Partial<BookmarkMenuProps> = {}): string {
  return renderToStaticMarkup(createElement(BookmarkMenu, {
    reference: "John 3:16",
    anchor: { getBoundingClientRect: () => ({ left: 100, right: 140, top: 100, bottom: 140, width: 40, height: 40 }) },
    colors,
    assignments: [],
    assignedTopicIds: [],
    recentColorIds: [],
    t: createUiTranslator("en"),
    onAdd() {},
    onRemove() {},
    onOpenTopic() {},
    onManageTopics() {},
    onClose() {},
    ...overrides,
  }));
}

test("bookmark menu identifies every topic and word selection with independently removable origins", () => {
  const html = render({
    assignments: [
      { id: "whole", colorId: "faith", hasGlobal: true, hasPersonal: true },
      { id: "word", colorId: "love", quote: "God so loved", hasGlobal: false, hasPersonal: true },
    ],
    assignedTopicIds: ["faith"],
  });
  assert.match(html, /role="dialog"/);
  assert.match(html, /Bookmarks for John 3:16/);
  assert.match(html, /Open Faith in Study/);
  assert.match(html, /Open Love in Study/);
  assert.match(html, /God so loved/);
  assert.match(html, /aria-label="Downloaded bookmark">G</);
  assert.match(html, /aria-label="Remove downloaded bookmark from Faith"/);
  assert.match(html, /aria-label="Remove personal bookmark from Faith"/);
  assert.match(html, /aria-label="Remove personal bookmark from Love"/);
  assert.doesNotMatch(html, /Remove downloaded bookmark from Love/);
});

test("topic picker excludes only explicit target memberships and lists recent topics first", () => {
  const html = render({ assignedTopicIds: ["faith"], recentColorIds: ["love", "love", "missing"] });
  assert.doesNotMatch(html, />Faith</);
  assert.match(html, />Hope</);
  assert.match(html, />Love</);
  assert.equal((html.match(/>Love</g) ?? []).length, 1);
  assert.ok(html.indexOf("Recent topics") < html.indexOf("All topics"));
  assert.ok(html.indexOf(">Love<") < html.indexOf(">Hope<"));

  const differentTarget = render({ assignedTopicIds: [] });
  assert.match(differentTarget, />Faith</);
});

test("selected text is explicit and a new user can create topics before any exist", () => {
  const html = render({ colors: [], quote: "For God so loved" });
  assert.match(html, /Selected text/);
  assert.match(html, /For God so loved/);
  assert.match(html, /No bookmarks yet\./);
  assert.match(html, /Create or manage topics/);
  assert.match(html, /aria-label="Close menu"/);
});
