import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createUiTranslator } from "../lib/i18n.ts";
import type { Translation } from "../lib/getbible.ts";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../app/components/DownloadManager.tsx", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "empty" },
  plugins: [{ name: "shared-react-runtime", setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const componentUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`;
const { DownloadManager, DownloadResourceCard } = await import(componentUrl) as typeof import("../app/components/DownloadManager");
const t = createUiTranslator("en");

test("download manager brings Bible and both study resource families into one labelled hub", () => {
  const translation = { abbreviation: "kjv", translation: "King James Version", sha: "a".repeat(40), lang: "en", language: "English", direction: "LTR" } satisfies Translation;
  const html = renderToStaticMarkup(createElement(DownloadManager, { translation, t }));
  assert.match(html, /Downloads &amp; storage/);
  assert.match(html, /King James Version/);
  assert.match(html, />Download translation</);
  assert.match(html, /aria-label="Dictionaries"/);
  assert.match(html, /aria-label="Commentaries"/);
  assert.match(html, />Clear Bible cache</);
  assert.match(html, /30 days/);
  assert.doesNotMatch(html, /Delete all.*bookmarks|Reset|Manage bookmarks/);
});

test("resource manager distinguishes complete downloads from read caches and exposes individual removals", () => {
  const html = renderToStaticMarkup(createElement(DownloadResourceCard, {
    kind: "dictionary", t, busy: false,
    resources: [
      { id: "strong", name: "Strong’s Greek", language: "en", bytes: 2_097_152 },
      { id: "chinese", name: "Greek–Chinese", language: "zh", bytes: 1_048_576 },
    ],
    saved: [
      { kind: "dictionary", id: "strong", downloaded: true, documents: 1, bytes: 2_097_152, savedAt: Date.now() },
      { kind: "dictionary", id: "chinese", downloaded: false, documents: 3, bytes: 4_096, savedAt: Date.now() - 40 * 86_400_000 },
    ],
    onDownload() {}, onClear() {}, onRemove() {},
  }));
  assert.match(html, /2 resources · 3\.0 MB/);
  assert.match(html, /1 complete · 2\.0 MB saved/);
  assert.match(html, /Available offline/);
  assert.match(html, /Recently read/);
  assert.match(html, /Refresh due/);
  assert.match(html, /Greek–Chinese · zh/);
  assert.match(html, /Remove Strong’s Greek from this browser/);
  assert.match(html, /Remove Greek–Chinese from this browser/);
  assert.match(html, />Refresh download</);
});

test("active downloads disable conflicting resource mutations", () => {
  const html = renderToStaticMarkup(createElement(DownloadResourceCard, {
    kind: "commentary", t, busy: true,
    resources: [{ id: "tsk", name: "Treasury of Scripture Knowledge", language: "en", bytes: 2_048 }],
    saved: [{ kind: "commentary", id: "tsk", downloaded: true, documents: 1, bytes: 2_048, savedAt: Date.now() }],
    onDownload() {}, onClear() {}, onRemove() {},
  }));
  const buttons = html.match(/<button\b[^>]*>/g) ?? [];
  assert.equal(buttons.length, 4);
  assert.ok(buttons.every((button) => /\bdisabled=""/.test(button)));
  assert.match(html, /<select[^>]*\bdisabled=""/);
});
