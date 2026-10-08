#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tracked font-cache CSS can originate from another checkout. Vinext rewrites
 * only the current checkout's absolute cache path, so make inherited paths
 * portable before compilation. This project uses Vite's default assetsDir.
 */
export async function normalizeCachedFontPaths(projectDirectory) {
  const fontRoot = resolve(projectDirectory, ".vinext", "fonts");
  let directories;
  try { directories = await readdir(fontRoot, { withFileTypes: true }); } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  let updated = 0;
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const stylesheet = resolve(fontRoot, directory.name, "style.css");
    let original;
    try { original = await readFile(stylesheet, "utf8"); } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    let normalized = original;
    for (const match of original.matchAll(/url\((["']?)([^)'"\s]+)\1\)/g)) {
      const source = match[2];
      const marker = source.indexOf("/.vinext/fonts/");
      if (!source.startsWith("/") || source.startsWith("//") || marker === -1) continue;
      const font = source.slice(marker + "/.vinext/fonts/".length);
      const parts = font.split("/");
      if (parts.length !== 2 || parts[0] !== directory.name || parts.some((part) => !part || part === "." || part === "..") || !/\.(?:woff2?|ttf|otf)$/.test(parts[1])) {
        throw new Error(`Invalid cached font URL in ${stylesheet}: ${source}`);
      }
      if (!(await stat(resolve(fontRoot, ...parts))).isFile()) throw new Error(`Cached font is not a file: ${font}`);
      normalized = normalized.replace(match[0], `url(${match[1]}/assets/_vinext_fonts/${font}${match[1]})`);
    }
    if (normalized !== original) {
      await writeFile(stylesheet, normalized);
      updated++;
    }
  }
  return updated;
}

/** Produce a deterministic release manifest from the actual compiled client. */
export async function generateOfflineManifest(clientDirectory) {
  const root = resolve(clientDirectory);
  const assets = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const url = `/${relative(root, path).split(sep).join("/")}`;
        if (url === "/sw.js" || url === "/offline-assets.js") continue;
        if (/\.(?:m?js|css|woff2?|ttf|otf)$/i.test(url) || /^\/locales\/[^/]+\.json$/.test(url) || /^\/favicon\.(?:png|svg|ico)$/.test(url)) {
          assets.push(url);
        }
      }
    }
  }
  await walk(root);
  assets.sort();
  if (!assets.some((path) => /\.m?js$/.test(path))) throw new Error("Offline manifest requires compiled JavaScript assets.");
  const digest = createHash("sha256");
  digest.update(await readFile(resolve(root, "sw.js")));
  for (const path of assets) {
    digest.update(path);
    digest.update(await readFile(resolve(root, `.${path}`)));
  }
  const manifest = { version: digest.digest("hex").slice(0, 24), assets: ["/", ...assets] };
  await writeFile(resolve(root, "offline-assets.js"), `/* Generated offline reader release manifest. */\nself.__GETBIBLE_OFFLINE__ = ${JSON.stringify(manifest)};\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--normalize-font-cache") {
    const count = await normalizeCachedFontPaths(process.argv[3] || process.cwd());
    if (count) console.log(`Corrected ${count} cached font stylesheets for portable reader URLs.`);
  } else {
    const manifest = await generateOfflineManifest(process.argv[2] || "dist/client");
    console.log(`Prepared offline reader ${manifest.version}: ${manifest.assets.length} shell assets.`);
  }
}
