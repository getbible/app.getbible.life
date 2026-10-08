import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { generateOfflineManifest, normalizeCachedFontPaths } from "../scripts/generate-offline.mjs";

const workerSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://app.getbible.life";
const version = "abcdef012345abcdef012345";
const cacheName = `getbible-shell-${version}`;
const shell = '<!doctype html><script src="/assets/reader-old.js"></script><link rel="stylesheet" href="/assets/reader.css"><main>Reader shell</main>';
const htmlResponse = (body = shell) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

function workerHarness() {
  const stores = new Map<string, Map<string, Response>>();
  const handlers = new Map<string, (event: unknown) => void>();
  let offline = false;
  let onlineShell = shell;
  let failedPath = "";
  let denyStorage = false;
  const requests: Request[] = [];
  const cacheKey = (request: Request | string) => new URL(typeof request === "string" ? request : request.url, origin).pathname;
  const sandbox = {
    self: {
      location: { origin },
      __GETBIBLE_OFFLINE__: { version, assets: ["/", "/assets/reader-old.js", "/assets/reader.css", "/locales/en.json", "/favicon.png"] },
      addEventListener: (name: string, callback: (event: unknown) => void) => { handlers.set(name, callback); },
    },
    importScripts: () => undefined,
    URL, Request, Response, AbortController, setTimeout, clearTimeout,
    caches: {
      async open(name: string) {
        if (denyStorage) throw new Error("Storage disabled");
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name)!;
        return {
          async put(request: Request | string, response: Response) { store.set(cacheKey(request), response.clone()); },
          async match(request: Request | string) { return store.get(cacheKey(request))?.clone(); },
        };
      },
      async keys() { return [...stores.keys()]; },
      async delete(name: string) { return stores.delete(name); },
    },
    async fetch(request: Request) {
      requests.push(request);
      if (offline) throw new Error("Offline");
      const path = new URL(request.url).pathname;
      if (path === failedPath) return new Response("Unavailable", { status: 503 });
      if (path === "/" || path === "/KJV/John/3") return htmlResponse(onlineShell);
      return new Response(`Asset ${path}`, { headers: { "content-type": path.endsWith(".js") ? "application/javascript" : "text/plain" } });
    },
  };
  vm.runInNewContext(workerSource, sandbox);
  return {
    stores, requests,
    setOffline(value: boolean) { offline = value; },
    setOnlineShell(value: string) { onlineShell = value; },
    failAsset(path: string) { failedPath = path; },
    denyStorage() { denyStorage = true; },
    async lifecycle(name: "install" | "activate") {
      let work: Promise<void> | undefined;
      handlers.get(name)!({ waitUntil(promise: Promise<void>) { work = promise; } });
      await work;
    },
    async request(path: string, options: { navigate?: boolean; method?: string; headers?: HeadersInit } = {}) {
      const request = new Request(new URL(path, origin), { method: options.method || "GET", headers: options.headers });
      if (options.navigate) Object.defineProperty(request, "mode", { value: "navigate" });
      let response: Promise<Response> | undefined;
      handlers.get("fetch")!({ request, respondWith(result: Promise<Response>) { response = result; } });
      return response ? await response : undefined;
    },
  };
}

test("offline manifest covers compiled chunks, local fonts and locales and changes with content", async () => {
  const root = await mkdtemp(join(tmpdir(), "getbible-offline-"));
  try {
    await mkdir(join(root, "assets"));
    await mkdir(join(root, "locales"));
    await Promise.all([
      writeFile(join(root, "sw.js"), workerSource),
      writeFile(join(root, "assets", "reader-a1.js"), "console.log('reader')"),
      writeFile(join(root, "assets", "reader-a1.js.map"), "sourcemap"),
      writeFile(join(root, "assets", "reader-b2.css"), "body{color:black}"),
      writeFile(join(root, "assets", "font-c3.woff2"), "font"),
      writeFile(join(root, "locales", "en.json"), '["Read"]'),
      writeFile(join(root, "favicon.png"), "icon"),
    ]);
    const first = await generateOfflineManifest(root);
    assert.deepEqual(first.assets, ["/", "/assets/font-c3.woff2", "/assets/reader-a1.js", "/assets/reader-b2.css", "/favicon.png", "/locales/en.json"]);
    assert.match(first.version, /^[a-f0-9]{24}$/);
    assert.equal((await generateOfflineManifest(root)).version, first.version);
    assert.match(await readFile(join(root, "offline-assets.js"), "utf8"), /self\.__GETBIBLE_OFFLINE__/);
    await writeFile(join(root, "locales", "en.json"), '["Read the Bible"]');
    assert.notEqual((await generateOfflineManifest(root)).version, first.version);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inherited font cache paths become portable before compilation", async () => {
  const root = await mkdtemp(join(tmpdir(), "getbible-font-cache-"));
  try {
    const fonts = join(root, ".vinext", "fonts", "geist-123");
    await mkdir(fonts, { recursive: true });
    await writeFile(join(fonts, "geist-abc.woff2"), "font");
    const stylesheet = join(fonts, "style.css");
    await writeFile(stylesheet, "@font-face{src:url('/original/checkout/.vinext/fonts/geist-123/geist-abc.woff2') format('woff2')}");
    assert.equal(await normalizeCachedFontPaths(root), 1);
    assert.equal(await readFile(stylesheet, "utf8"), "@font-face{src:url('/assets/_vinext_fonts/geist-123/geist-abc.woff2') format('woff2')}");
    assert.equal(await normalizeCachedFontPaths(root), 0);
    await writeFile(stylesheet, "@font-face{src:url(/original/.vinext/fonts/geist-123/missing.woff2)}");
    await assert.rejects(normalizeCachedFontPaths(root), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installs the complete shell then reads chapters and assets after connection loss", async () => {
  const worker = workerHarness();
  await worker.lifecycle("install");
  assert.equal(worker.stores.get(cacheName)?.size, 5);
  assert.ok(worker.requests.every((request) => request.cache === "reload"));
  worker.setOffline(true);
  const response = await worker.request("/KJV/John/3", { navigate: true });
  assert.equal(await response?.text(), shell);
  assert.equal(await (await worker.request("/assets/reader-old.js"))?.text(), "Asset /assets/reader-old.js");
});

test("failed installation keeps previous reader and data caches", async () => {
  const worker = workerHarness();
  worker.stores.set("getbible-shell-previous", new Map());
  worker.stores.set("getbible-reader:v3", new Map());
  worker.failAsset("/assets/reader.css");
  await assert.rejects(worker.lifecycle("install"), /Cannot cache reader asset/);
  assert.equal(worker.stores.has(cacheName), false);
  assert.equal(worker.stores.has("getbible-shell-previous"), true);
  assert.equal(worker.stores.has("getbible-reader:v3"), true);
});

test("activation removes old shells while preserving translations and study resources", async () => {
  const worker = workerHarness();
  await worker.lifecycle("install");
  worker.stores.set("getbible-shell-previous", new Map());
  worker.stores.set("getbible-reader:v3", new Map());
  worker.stores.set("getbible-study:v1", new Map());
  await worker.lifecycle("activate");
  assert.deepEqual([...worker.stores.keys()], [cacheName, "getbible-reader:v3", "getbible-study:v1"]);
});

test("a new release's online HTML never overwrites an older worker's offline shell", async () => {
  const worker = workerHarness();
  await worker.lifecycle("install");
  const newShell = '<!doctype html><script src="/assets/reader-new.js"></script>';
  worker.setOnlineShell(newShell);
  assert.equal(await (await worker.request("/", { navigate: true }))?.text(), newShell);
  worker.setOffline(true);
  assert.equal(await (await worker.request("/", { navigate: true }))?.text(), shell);
});

test("accepts Vinext inline boot imports and rejects new RSC module chunks", async () => {
  const worker = workerHarness();
  const inlineShell = '<!doctype html><link rel="modulepreload" href="/assets/reader-old.js"><script>import("/assets/reader-old.js");self.__VINEXT_RSC_CHUNKS__=["/assets/reader-old.js"]</script>';
  worker.setOnlineShell(inlineShell);
  await worker.lifecycle("install");
  const changedChunks = inlineShell.replace('["/assets/reader-old.js"]', '["/assets/page-new.js"]');
  worker.setOnlineShell(changedChunks);
  assert.equal(await (await worker.request("/", { navigate: true }))?.text(), changedChunks);
  worker.setOffline(true);
  assert.equal(await (await worker.request("/", { navigate: true }))?.text(), inlineShell);
});

test("external APIs, writes, authentication, range and unknown routes are never intercepted", async () => {
  const worker = workerHarness();
  for (const [path, options] of [
    ["https://api.getbible.net/v3/kjv.json", {}],
    ["/api/private", {}],
    ["/assets/unlisted.js", {}],
    ["/assets/reader-old.js", { method: "POST" }],
    ["/assets/reader-old.js", { headers: { authorization: "Bearer example" } }],
    ["/assets/reader-old.js", { headers: { range: "bytes=0-9" } }],
    ["/sign-in", { navigate: true }],
  ] as const) {
    assert.equal(await worker.request(path, options), undefined);
  }
  assert.equal(worker.requests.length, 0);
});

test("storage denial still allows online navigation and asset responses", async () => {
  const worker = workerHarness();
  worker.denyStorage();
  assert.equal(await (await worker.request("/KJV/John/3", { navigate: true }))?.text(), shell);
  assert.equal(await (await worker.request("/assets/reader-old.js"))?.text(), "Asset /assets/reader-old.js");
});
