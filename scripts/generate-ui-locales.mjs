#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ENGLISH_UI_MESSAGES } from "../lib/i18n.ts";

const TRANSLATIONS_URL = "https://api.getbible.net/v2/translations.json";
const BING_TRANSLATOR_URL = "https://www.bing.com/translator";
const CONCURRENCY = 2;
const MAX_CHUNK_LENGTH = 2_400;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0";
const LOCALE_DIRECTORY = new URL("../public/locales/", import.meta.url);

const TARGET_ALIASES = {
  enm: "en",
  hbo: "he",
  grc: "el",
  cu: "ru",
  cop: "ar",
  got: "de",
  mlf: "ml",
  rmq: "es",
  mn: "mn-Cyrl",
  nd: "zu",
  nn: "nb",
  sr: "sr-Cyrl",
  syr: "ar",
  tl: "fil",
  tlh: "tlh-Latn",
  tsg: "fil",
  ppk: "id",
  zh: "zh-Hans",
};

const SAFE_FALLBACKS = {
  ch: "en",
  chr: "en",
  br: "en",
  eo: "en",
  gd: "en",
  gv: "en",
  la: "en",
  pon: "en",
  pot: "en",
  tpi: "en",
};

const PROTECTED_TERMS = ["getBible.Life", "GetBible API", "getBible", "CrossWire", "SWORD", "Markdown", "SHA", "LCSH", ".md"];
const MESSAGE_KEYS = Object.keys(ENGLISH_UI_MESSAGES);

async function currentMessages(locale) {
  try {
    const pack = JSON.parse(await readFile(new URL(`${locale}.json`, LOCALE_DIRECTORY), "utf8"));
    if (!Array.isArray(pack)) return {};
    return Object.fromEntries(MESSAGE_KEYS.map((key, index) => [key, pack[index] || undefined]).filter(([, value]) => value));
  } catch {
    return {};
  }
}

function protect(value) {
  const replacements = [];
  const protectedValue = value
    .replace(/\{[a-zA-Z][a-zA-Z0-9]*\}/g, (match) => {
      const token = `GBPH${String(replacements.length).padStart(3, "0")}GB`;
      replacements.push([token, match]);
      return token;
    });
  const withTerms = PROTECTED_TERMS.reduce((current, term) => current.replaceAll(term, () => {
    const token = `GBPH${String(replacements.length).padStart(3, "0")}GB`;
    replacements.push([token, term]);
    return token;
  }), protectedValue);
  return { value: withTerms, replacements };
}

function restore(value, replacements) {
  return replacements.reduce((current, [token, original]) => current.replaceAll(token, original), value).trim();
}

function placeholders(value) {
  return [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map((match) => match[1]).sort().join("|");
}

let bingConfigPromise;
let bingSequence = 0;

async function bingConfig() {
  if (!bingConfigPromise) bingConfigPromise = (async () => {
    const response = await fetch(BING_TRANSLATOR_URL, { headers: { "user-agent": USER_AGENT } });
    if (!response.ok) throw new Error(`Bing Translator returned HTTP ${response.status}`);
    const html = await response.text();
    const IG = html.match(/IG:"([^"]+)"/)?.[1];
    const IID = html.match(/data-iid="([^"]+)"/)?.[1];
    const abuse = html.match(/params_AbusePreventionHelper\s?=\s?([^\]]+\])/)?.[1];
    if (!IG || !IID || !abuse) throw new Error("Bing Translator configuration could not be read");
    const [key, token] = JSON.parse(abuse);
    return { IG, IID, key, token };
  })();
  return bingConfigPromise;
}

async function translateChunk(text, target) {
  const { IG, IID, key, token } = await bingConfig();
  const sequence = ++bingSequence;
  const form = new URLSearchParams({
    fromLang: "en",
    to: target,
    text,
    token,
    key: String(key),
    tryFetchingGenderDebiasedTranslations: "true",
  });
  const endpoint = `https://www.bing.com/ttranslatev3?isVertical=1&IG=${encodeURIComponent(IG)}&IID=${encodeURIComponent(IID)}&SFX=${sequence}&ref=TThis&edgepdftranslator=1`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      referer: BING_TRANSLATOR_URL,
      "user-agent": USER_AGENT,
    },
    body: form,
  });
  if (!response.ok) throw new Error(`translation service returned HTTP ${response.status}`);
  const payload = await response.json();
  const translated = payload?.[0]?.translations?.[0]?.text;
  if (!translated) throw new Error("translation service returned no text");
  return translated;
}

function entryChunks(entries) {
  const chunks = [];
  let chunk = [];
  let length = 0;
  for (const entry of entries) {
    const size = entry.value.length + 16;
    if (chunk.length && length + size > MAX_CHUNK_LENGTH) {
      chunks.push(chunk);
      chunk = [];
      length = 0;
    }
    chunk.push(entry);
    length += size;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

async function translateLocale(locale) {
  const existing = await currentMessages(locale);
  const missingMessages = Object.fromEntries(Object.entries(ENGLISH_UI_MESSAGES).filter(([key]) => !existing[key]));
  if (locale === "en" || !Object.keys(missingMessages).length) return existing;
  const target = SAFE_FALLBACKS[locale] ?? TARGET_ALIASES[locale] ?? locale;
  if (target === "en") return existing;
  const entries = Object.entries(missingMessages).map(([key, value], index) => ({
    key,
    index,
    original: value,
    ...protect(value),
  }));
  const output = {};
  for (const chunk of entryChunks(entries)) {
    const body = chunk.map((entry) => `@@GB${String(entry.index).padStart(3, "0")}@@\n${entry.value}`).join("\n");
    const translated = await translateChunk(body, target);
    for (const [position, entry] of chunk.entries()) {
      const marker = `@@GB${String(entry.index).padStart(3, "0")}@@`;
      const nextEntry = chunk[position + 1];
      const nextMarker = nextEntry ? `@@GB${String(nextEntry.index).padStart(3, "0")}@@` : null;
      const start = translated.indexOf(marker);
      const end = nextMarker ? translated.indexOf(nextMarker, start + marker.length) : translated.length;
      if (start < 0 || end < 0) continue;
      const value = restore(translated.slice(start + marker.length, end), entry.replacements);
      if (value && placeholders(value) === placeholders(entry.original)) output[entry.key] = value;
    }
  }
  return { ...existing, ...output };
}

async function concurrentMap(values, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      try {
        results[index] = await worker(values[index]);
        process.stdout.write(`✓ ${values[index]}\n`);
      } catch (error) {
        process.stderr.write(`! ${error instanceof Error ? error.message : String(error)}; using English fallback\n`);
        results[index] = await currentMessages(values[index]);
      }
    }
  }));
  return results;
}

const response = await fetch(TRANSLATIONS_URL);
if (!response.ok) throw new Error(`GetBible returned HTTP ${response.status}`);
const translations = await response.json();
const locales = [...new Set(Object.values(translations).map((translation) => translation.lang || "en"))].sort((a, b) => a.localeCompare(b));
if (!locales.includes("en")) locales.unshift("en");
const packs = await concurrentMap(locales, translateLocale);
await mkdir(LOCALE_DIRECTORY, { recursive: true });
await Promise.all(locales.map((locale, index) => {
  const values = MESSAGE_KEYS.map((key) => packs[index][key] ?? "");
  return writeFile(new URL(`${locale}.json`, LOCALE_DIRECTORY), JSON.stringify(values));
}));
await writeFile(new URL("index.json", LOCALE_DIRECTORY), JSON.stringify(locales));
process.stdout.write(`Generated ${locales.length} UI locale packs.\n`);
