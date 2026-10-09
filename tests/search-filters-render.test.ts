import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SearchFilterValue } from "../app/components/SearchFilters";
import { createUiTranslator } from "../lib/i18n.ts";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../app/components/SearchFilters.tsx", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic",
  loader: { ".css": "empty" },
  plugins: [{
    name: "shared-react-runtime",
    setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    },
  }],
});
const { SearchFilters, DEFAULT_SEARCH_FILTERS } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`) as typeof import("../app/components/SearchFilters");

function render(value: Partial<SearchFilterValue> = {}) {
  return renderToStaticMarkup(createElement(SearchFilters, {
    value: { ...DEFAULT_SEARCH_FILTERS, ...value },
    books: [{ nr: 1, name: "Genesis" }, { nr: 43, name: "John" }],
    t: createUiTranslator("en"), onChange() {}, onReset() {},
  }));
}

test("search keeps Testament scope, book and global sort controls directly accessible", () => {
  const html = render({ scope: "nt", sort: "canonical_desc" });
  assert.match(html, /aria-pressed="true">New Testament</);
  assert.match(html, /<option value="canonical_desc" selected="">Last to first</);
  assert.match(html, /<option value="43">John</);
  assert.match(html, /2 active/);
  assert.ok(html.indexOf("Last to first") < html.indexOf("<details"));
  assert.ok(html.indexOf("New Testament") < html.indexOf("<details"));
});

test("advanced filters expose a labelled grid and disable proximity for unsupported word modes", () => {
  const html = render({ words: "phrase", caseSensitive: true, diacritics: "exact", exclude: "darkness", proximity: 3 });
  assert.match(html, /4 active/);
  assert.match(html, />More filters</);
  assert.match(html, /type="number"[^>]*disabled=""[^>]*aria-describedby=/);
  assert.match(html, /placeholder="e.g. darkness death" value="darkness"/);
  assert.match(html, /<option value="exact" selected="">Match accents</);
  assert.match(html, /Maximum words between matches/);
});

test("unfiltered search starts with whole Bible and makes reset inactive", () => {
  const html = render();
  assert.match(html, /aria-pressed="true">Whole Bible</);
  assert.match(html, /<button type="button" disabled="">Reset filters</);
  assert.doesNotMatch(html, /\d active/);
});
