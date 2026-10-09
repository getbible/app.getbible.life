import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SearchResultCardProps } from "../app/components/SearchResultCard";
import { createUiTranslator } from "../lib/i18n.ts";
import type { ServerSearchVerse } from "../lib/scripture-api.ts";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../app/components/SearchResultCard.tsx", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic",
  plugins: [{
    name: "shared-react-runtime",
    setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    },
  }],
});
const { SearchResultCard } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`) as typeof import("../app/components/SearchResultCard");

const verseText = "In the beginning was the Word, and the Word was with God, and the Word was God.";
const result: ServerSearchVerse = {
  book: 43, bookName: "John", chapter: 1, verse: 1, reference: "John 1:1", text: verseText,
  verseData: { chapter: 1, verse: 1, name: "John 1:1", text: verseText },
  occurrences: 3, terms: ["word"], score: 12.3456,
};
function render(overrides: Partial<SearchResultCardProps> = {}) {
  return renderToStaticMarkup(createElement(SearchResultCard, {
    result, query: "word", match: "exact", caseSensitive: false, locale: "en",
    showScore: false, t: createUiTranslator("en"), onOpen() {}, ...overrides,
  }));
}

test("search card keeps the complete verse and reference while highlighting every matching word", () => {
  const html = render();
  assert.match(html, /^<button[^>]*type="button"/);
  assert.match(html, /<strong>John 1:1<\/strong>/);
  assert.equal((html.match(/<mark>Word<\/mark>/g) ?? []).length, 3);
  const renderedVerse = html.match(/<span class="search-result-text">([\s\S]*?)<\/span>/)?.[1];
  assert.equal(renderedVerse?.replace(/<\/?mark>/g, ""), verseText);
  assert.match(html, /3 word matches/);
  assert.match(html, /Matched: word/);
  assert.doesNotMatch(html, /Match score/);
});

test("relevance results expose the API score alongside occurrence and matched-term metadata", () => {
  const html = render({ showScore: true, result: { ...result, terms: ["word", "god"], score: 1200.1234 } });
  assert.match(html, /3 word matches/);
  assert.match(html, /Matched: word · god/);
  assert.match(html, /Match score 1,200\.12/);
  assert.equal((html.match(/search-result-details/g) ?? []).length, 1);
});

test("reference-only results omit unavailable metadata and respect case-sensitive highlighting", () => {
  const html = render({
    caseSensitive: true, showScore: true,
    result: { ...result, occurrences: undefined, terms: undefined, score: undefined },
  });
  assert.match(html, /John 1:1/);
  assert.match(html, /In the beginning was the Word/);
  assert.doesNotMatch(html, /<mark>|search-result-details|Matched:|word matches|Match score/);
});

test("API text and metadata are escaped while zero-valued metadata remains visible", () => {
  const html = render({
    query: "", showScore: true,
    result: { ...result, text: "<script>alert(1)</script>", terms: ["<img>"], occurrences: 0, score: 0 },
  });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Matched: &lt;img&gt;/);
  assert.match(html, /0 word matches/);
  assert.match(html, /Match score 0/);
  assert.doesNotMatch(html, /<script|<img/);
});
