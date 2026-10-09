"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { clearCache, fullTranslation, fullTranslationAvailable, getDownloadedTranslations, removeDownloadedTranslation } from "../../lib/cache";
import { isCacheFresh } from "../../lib/cache-policy";
import type { Translation } from "../../lib/getbible";
import type { createUiTranslator } from "../../lib/i18n";
import { prepareOfflineReader } from "../../lib/offline-ready";
import { clearQueryCache } from "../../lib/scripture-api";
import {
  clearStudyCache, downloadAllStudyResources, downloadCommentary, downloadDictionary,
  getCommentaryCatalog, getDictionaryCatalog, listStudyCache, removeStudyDownload,
  type ResourceKind,
} from "../../lib/study-api";
import "./download-manager.css";

type Translator = ReturnType<typeof createUiTranslator>;
type SavedTranslation = Awaited<ReturnType<typeof getDownloadedTranslations>>[number];
type SavedResource = Awaited<ReturnType<typeof listStudyCache>>[number];
type Resource = { id: string; name: string; language: string; bytes: number };
type Progress = { completed: number; total: number; name: string };

export interface DownloadManagerProps {
  translation: Translation | null;
  t: Translator;
  onCacheChange?: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

function SavedDate({ savedAt, t }: { savedAt: number; t: Translator }) {
  if (!savedAt) return <span>{t("downloadStale")}</span>;
  return <span>{t("savedDate", { date: new Date(savedAt).toLocaleDateString() })}{!isCacheFresh(savedAt) ? ` · ${t("downloadStale")}` : ""}</span>;
}

interface ResourceCardProps {
  kind: ResourceKind;
  resources: Resource[];
  saved: SavedResource[];
  busy: boolean;
  loading?: boolean;
  t: Translator;
  onDownload: (kind: ResourceKind, resource?: Resource) => void;
  onRemove: (kind: ResourceKind, id: string) => void;
  onClear: (kind: ResourceKind) => void;
}

export function DownloadResourceCard({ kind, resources, saved, busy, loading = false, t, onDownload, onRemove, onClear }: ResourceCardProps) {
  const [selectedId, setSelectedId] = useState("");
  const selectId = useId();
  const selected = resources.find((resource) => resource.id === selectedId) ?? resources[0];
  const selectedSaved = saved.find((resource) => resource.id === selected?.id);
  const totalSize = resources.reduce((total, resource) => total + resource.bytes, 0);
  const sorted = [...resources].sort((a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name));
  const title = t(kind === "dictionary" ? "dictionariesLabel" : "commentariesLabel");
  return <section className="download-card" aria-label={title} aria-busy={loading}>
    <div className="download-card-heading"><h4>{title}</h4><span className="download-count">{saved.filter((resource) => resource.downloaded).length}</span></div>
    <p className="download-meta">{loading ? t("downloadBusy") : t("catalogDownloadSize", { count: resources.length, size: formatSize(totalSize) })}</p>
    <div className="download-actions">
      <button type="button" className="download-primary" disabled={busy || !resources.length} onClick={() => onDownload(kind)}>{t("downloadAllResources")}</button>
      <button type="button" disabled={busy} onClick={() => onClear(kind)}>{t("clearResourceCache")}</button>
    </div>
    {resources.length ? <details className="download-resource-picker">
      <summary>{t("manageResources")}</summary>
      <label className="download-select" htmlFor={selectId}>{title}</label>
      <select id={selectId} value={selected?.id ?? ""} disabled={busy} onChange={(event) => setSelectedId(event.target.value)}>
        {sorted.map((resource) => <option key={resource.id} value={resource.id}>{resource.name} · {resource.language}</option>)}
      </select>
      {selected ? <div className="download-selected">
        <span className="download-meta">{formatSize(selected.bytes)}{selectedSaved?.downloaded ? ` · ${t("savedOffline")}` : ""}</span>
        <button type="button" disabled={busy} onClick={() => onDownload(kind, selected)}>{t(selectedSaved?.downloaded ? "refreshDownload" : "downloadResource")}</button>
      </div> : null}
    </details> : null}
    <p className="download-meta download-saved-summary">{saved.length ? t("savedResourceCount", { count: saved.filter((resource) => resource.downloaded).length, size: formatSize(saved.reduce((total, resource) => total + resource.bytes, 0)) }) : t("nothingSaved")}</p>
    {saved.length ? <ul className="download-saved-list">
      {saved.map((resource) => {
        const description = resources.find((candidate) => candidate.id === resource.id);
        const name = description?.name ?? resource.id;
        return <li key={resource.id}>
          <div><strong>{name}</strong><span className="download-meta">{t(resource.downloaded ? "savedOffline" : "readCacheOnly")} · {formatSize(resource.bytes)}</span><span className="download-meta"><SavedDate savedAt={resource.savedAt} t={t} /></span></div>
          <button type="button" disabled={busy} aria-label={t("downloadRemoveLabel", { name })} onClick={() => onRemove(kind, resource.id)}>{t("removeDownload")}</button>
        </li>;
      })}
    </ul> : null}
  </section>;
}

export function DownloadManager({ translation, t, onCacheChange }: DownloadManagerProps) {
  const titleId = useId();
  const [savedTranslations, setSavedTranslations] = useState<SavedTranslation[]>([]);
  const [savedResources, setSavedResources] = useState<SavedResource[]>([]);
  const [catalogs, setCatalogs] = useState<Record<ResourceKind, Resource[]>>({ dictionary: [], commentary: [] });
  const [catalogError, setCatalogError] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const change = useRef(onCacheChange);
  useEffect(() => { change.current = onCacheChange; }, [onCacheChange]);

  const refreshInventory = useCallback(async () => {
    const [translations, resources] = await Promise.all([getDownloadedTranslations(), listStudyCache()]);
    if (mounted.current) { setSavedTranslations(translations); setSavedResources(resources); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  useEffect(() => {
    const request = new AbortController();
    void refreshInventory().catch(() => undefined);
    void Promise.allSettled([getDictionaryCatalog(request.signal), getCommentaryCatalog(request.signal)]).then(([dictionaries, commentaries]) => {
      if (request.signal.aborted) return;
      setCatalogLoading(false);
      setCatalogError(dictionaries.status === "rejected" || commentaries.status === "rejected");
      setCatalogs({
        dictionary: dictionaries.status === "fulfilled" ? dictionaries.value.dictionaries.filter((item) => item.entry_count > 0) : [],
        commentary: commentaries.status === "fulfilled" ? commentaries.value.commentaries.filter((item) => item.entry_count > 0) : [],
      });
    });
    return () => request.abort();
  }, [retry, refreshInventory]);

  const run = async (operation: (signal: AbortSignal) => Promise<string>, initialProgress?: Progress) => {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true); setError(""); setNotice(""); setProgress(initialProgress ?? null);
    try {
      const message = await operation(request.signal);
      if (mounted.current) setNotice(request.signal.aborted ? t("downloadsCancelled") : message);
    } catch (caught) {
      if (mounted.current) {
        if (request.signal.aborted || (caught instanceof Error && caught.name === "AbortError")) setNotice(t("downloadsCancelled"));
        else setError(caught instanceof Error ? caught.message : t("downloadStorageError"));
      }
    } finally {
      if (controller.current === request) controller.current = null;
      if (mounted.current) {
        setBusy(false); setProgress(null);
        await refreshInventory().catch(() => undefined);
        change.current?.();
      }
    }
  };

  const saveTranslation = () => {
    if (!translation) return;
    const current = translation;
    void run(async (signal) => {
      const readerReady = await prepareOfflineReader(10_000, signal);
      signal.throwIfAborted();
      const result = await fullTranslation(current.abbreviation, current.sha, { force: true, signal });
      signal.throwIfAborted();
      if (!result.persisted || !(await fullTranslationAvailable(current.abbreviation))) throw new Error(t("downloadStorageError"));
      return t(readerReady ? "downloadsSaved" : "offlineShellUnavailable");
    }, { completed: 0, total: 1, name: current.translation });
  };

  const saveResource = (kind: ResourceKind, resource?: Resource) => {
    void run(async (signal) => {
      const readerReady = await prepareOfflineReader(10_000, signal);
      signal.throwIfAborted();
      if (resource) await (kind === "dictionary" ? downloadDictionary : downloadCommentary)(resource.id, signal);
      else await downloadAllStudyResources(kind, (value) => {
        if (mounted.current && !signal.aborted) setProgress(value);
      }, signal);
      signal.throwIfAborted();
      return t(readerReady ? "downloadsSaved" : "offlineShellUnavailable");
    }, { completed: 0, total: resource ? 1 : catalogs[kind].length, name: resource?.name ?? t(kind === "dictionary" ? "dictionariesLabel" : "commentariesLabel") });
  };

  const savedCurrent = savedTranslations.find((item) => item.abbreviation === translation?.abbreviation);
  return <section className="download-manager" aria-labelledby={titleId}>
    <header><h3 id={titleId}>{t("downloadsTitle")}</h3><p>{t("downloadsDescription")}</p></header>
    <section className="download-card" aria-label={t("cachedTranslationLabel")}>
      <div className="download-card-heading"><h4>{t("downloadCurrentTranslation")}</h4>{savedCurrent ? <span className="download-ready" aria-label={t("savedOffline")}>✓</span> : null}</div>
      <p className="download-translation-name">{translation?.translation ?? t("translation")}</p>
      {savedCurrent ? <p className="download-meta">{formatSize(savedCurrent.bytes)} · <SavedDate savedAt={savedCurrent.savedAt} t={t} /></p> : null}
      <div className="download-actions"><button className="download-primary" type="button" disabled={busy || !translation} onClick={saveTranslation}>{t(savedCurrent ? "refreshDownload" : "downloadTranslation")}</button><button type="button" disabled={busy} onClick={() => void run(async () => { await Promise.all([clearCache(), clearQueryCache()]); return t("cacheCleared"); })}>{t("clearTranslationCache")}</button></div>
      {savedTranslations.length ? <details className="download-resource-picker"><summary>{t("savedTranslations")} <span>{savedTranslations.length}</span></summary><ul className="download-saved-list">
        {savedTranslations.map((saved) => <li key={saved.abbreviation}>
          <div><strong>{saved.name}</strong><span className="download-meta">{saved.abbreviation.toUpperCase()} · {formatSize(saved.bytes)}</span><span className="download-meta"><SavedDate savedAt={saved.savedAt} t={t} /></span></div>
          <button type="button" disabled={busy} aria-label={t("downloadRemoveLabel", { name: saved.name })} onClick={() => void run(async () => { await removeDownloadedTranslation(saved.abbreviation); return t("cacheCleared"); })}>{t("removeDownload")}</button>
        </li>)}
      </ul></details> : null}
    </section>
    {(["dictionary", "commentary"] as const).map((kind) => <DownloadResourceCard key={kind} kind={kind} resources={catalogs[kind]} saved={savedResources.filter((resource) => resource.kind === kind)} busy={busy} loading={catalogLoading} t={t} onDownload={saveResource}
      onClear={(value) => void run(async () => { await clearStudyCache(value); return t("cacheCleared"); })}
      onRemove={(value, id) => void run(async () => { await removeStudyDownload(value, id); return t("cacheCleared"); })}
    />)}
    {catalogError ? <p className="download-message">{t("downloadCatalogError")} <button type="button" disabled={busy || catalogLoading} onClick={() => { setCatalogLoading(true); setRetry((value) => value + 1); }}>{t("downloadRetry")}</button></p> : null}
    {busy ? <div className="download-progress" role="status">
      <div><strong>{progress ? t("downloadingResource", { name: progress.name }) : t("downloadBusy")}</strong>{progress ? <button type="button" onClick={() => controller.current?.abort()}>{t("cancelDownload")}</button> : null}</div>
      <progress aria-label={t("downloadBusy")} max={progress?.total || 1} value={progress && progress.total > 1 ? progress.completed : undefined} />
      {progress && progress.total > 1 ? <span>{t("downloadProgress", { completed: progress.completed, total: progress.total })}</span> : null}
      {progress ? <span>{t("downloadKeepOpen")}</span> : null}
    </div> : null}
    {notice ? <p className="download-message" role="status">{notice}</p> : null}
    {error ? <p className="download-message download-error" role="alert">{error}</p> : null}
  </section>;
}
