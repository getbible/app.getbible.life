/* global importScripts */
"use strict";

// Emitted after compilation. A missing manifest leaves the previous worker active.
importScripts("/offline-assets.js");
const manifest = self.__GETBIBLE_OFFLINE__;
if (!manifest || !/^[a-f0-9]{24}$/.test(manifest.version) || !Array.isArray(manifest.assets) || !manifest.assets.includes("/")) {
  throw new Error("The offline reader manifest is missing or invalid.");
}
const CACHE_PREFIX = "getbible-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${manifest.version}`;
const ASSETS = new Set(manifest.assets.filter((path) => typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !/[?#]/.test(path)));
const ORIGIN = self.location.origin;
const CACHED_AT = "x-getbible-cached-at";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function cacheable(response) {
  return response.ok && !response.redirected && response.type !== "opaque";
}

function stamped(response) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT, String(Date.now()));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isReaderPath(path) {
  if (path === "/") return true;
  const segments = path.split("/").filter(Boolean);
  return segments.length === 3 && /^[a-z0-9_-]+$/i.test(segments[0]) && /^\d+$/.test(segments[2]);
}

// A worker from the previous release may still control an open reader tab.
// Never overwrite its fallback with HTML that points to a different release.
async function compatibleShell(response) {
  if (!cacheable(response) || !(response.headers.get("content-type") || "").includes("text/html")) return false;
  const html = await response.clone().text();
  const sources = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  for (const source of sources) {
    const url = new URL(source.replace(/&amp;/g, "&"), ORIGIN);
    if (url.origin === ORIGIN && !ASSETS.has(url.pathname)) return false;
  }
  // Vinext boots via inline import() and embeds client-module URLs in RSC data,
  // rather than relying exclusively on script[src] tags. Check those references
  // too: an unchanged bootstrap must not mask a newly compiled page chunk.
  let hasLocalScript = false;
  const references = html.replace(/\\\//g, "/").match(/(?:https?:\/\/[^/\s"'<>\\]+)?\/[^"'<>\\\s?#]*\.(?:m?js|css)\b/g) || [];
  for (const reference of references) {
    const url = new URL(reference, ORIGIN);
    if (url.origin !== ORIGIN) continue;
    if (!ASSETS.has(url.pathname)) return false;
    if (/\.m?js$/.test(url.pathname)) hasLocalScript = true;
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel\s*=\s*["'](?:stylesheet|modulepreload)["']/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const url = new URL(href.replace(/&amp;/g, "&"), ORIGIN);
    if (url.origin === ORIGIN && !ASSETS.has(url.pathname)) return false;
  }
  return hasLocalScript;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await Promise.all([...ASSETS].map(async (path) => {
        const response = await fetch(new Request(new URL(path, ORIGIN), { cache: "reload", credentials: "same-origin" }));
        if (!cacheable(response) || (path === "/" && !await compatibleShell(response))) throw new Error(`Cannot cache reader asset: ${path}`);
        await cache.put(path, stamped(response));
      }));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
    // A completed release can take over immediately. Older compiled assets stay
    // available below so already open tabs can still load their own lazy chunks.
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    for (const name of names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)) {
      const cache = await caches.open(name);
      const shell = await cache.match("/");
      if (!shell) { await caches.delete(name); continue; }
      const savedAt = Number(shell.headers.get(CACHED_AT));
      if (savedAt > 0 && Date.now() - savedAt >= MAX_AGE_MS) await caches.delete(name);
      else if (!savedAt) await cache.put("/", stamped(shell));
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const port = event.ports?.[0];
  if (event.data?.type !== "getbible-offline-ready" || !port) return;
  event.waitUntil((async () => {
    let ready = false;
    try {
      const cache = await caches.open(CACHE_NAME);
      const stored = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
      ready = [...ASSETS].every((path) => stored.has(path));
    } catch { /* Report storage failures without interrupting online reading. */ }
    port.postMessage({ type: "getbible-offline-ready", ready, version: manifest.version });
  })());
});

async function navigation(request) {
  let cache;
  try { cache = await caches.open(CACHE_NAME); } catch { return fetch(request); }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(new Request(request, { signal: controller.signal }));
    if (response.status < 500) {
      const url = new URL(request.url);
      if (url.pathname === "/" && await compatibleShell(response)) {
        try { await cache.put("/", stamped(response.clone())); } catch { /* A full cache must not prevent online reading. */ }
      }
      return response;
    }
    return await cache.match("/") || response;
  } catch (error) {
    const shell = await cache.match("/");
    if (shell) return shell;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function asset(request, pathname) {
  let cache;
  try { cache = await caches.open(CACHE_NAME); } catch { return fetch(request); }
  const saved = await cache.match(pathname);
  if (saved) return saved;
  // Older open tabs may ask for a chunk that does not belong to this release.
  // Retained shell caches are the only fallback; API caches remain independent.
  for (const name of (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)) {
    const previous = await (await caches.open(name)).match(pathname);
    if (previous) return previous;
  }
  const response = await fetch(request);
  if (ASSETS.has(pathname) && cacheable(response)) {
    try { await cache.put(pathname, stamped(response.clone())); } catch { /* Continue online when device storage is full. */ }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== ORIGIN || request.headers.has("range") || request.headers.has("authorization")) return;
  if (request.mode === "navigate" && isReaderPath(url.pathname)) {
    event.respondWith(navigation(request));
  } else if (url.pathname !== "/" && (ASSETS.has(url.pathname) || /^\/assets\/[^?#]+\.(?:m?js|css|woff2?)$/.test(url.pathname)) && !url.search) {
    event.respondWith(asset(request, url.pathname));
  }
});
