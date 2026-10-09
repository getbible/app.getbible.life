"use client";

import { useId } from "react";
import type { Book } from "../../lib/getbible";
import type { createUiTranslator } from "../../lib/i18n";
import type { MatchMode, SearchScope, WordMode } from "../../lib/search";
import type { SearchSort } from "../../lib/scripture-api";
import "./search-filters.css";

export interface SearchFilterValue {
  words: WordMode;
  match: MatchMode;
  caseSensitive: boolean;
  scope: SearchScope;
  sort: SearchSort;
  diacritics: "fold" | "exact";
  exclude: string;
  proximity?: number;
}

export const DEFAULT_SEARCH_FILTERS: SearchFilterValue = {
  words: "all", match: "exact", caseSensitive: false, scope: "all",
  sort: "canonical", diacritics: "fold", exclude: "", proximity: undefined,
};

export interface SearchFiltersProps {
  value: SearchFilterValue;
  books: Pick<Book, "nr" | "name">[];
  t: ReturnType<typeof createUiTranslator>;
  onChange: (value: SearchFilterValue) => void;
  onReset: () => void;
}

export function SearchFilters({ value, books, t, onChange, onReset }: SearchFiltersProps) {
  const proximityHelp = useId();
  const update = (patch: Partial<SearchFilterValue>) => onChange({ ...value, ...patch });
  const activeCount = Number(value.scope !== "all") + Number(value.sort !== "canonical")
    + Number(value.words !== "all") + Number(value.match !== "exact") + Number(value.caseSensitive)
    + Number(value.diacritics !== "fold") + Number(Boolean(value.exclude.trim()))
    + Number(value.words === "all" && value.proximity !== undefined);
  const selectedBook = value.scope.startsWith("book:") ? value.scope.slice(5) : "";

  return <div className="search-filter-panel" aria-label={t("searchFilters")}>
    <div className="search-filter-toolbar">
      <div className="search-scope-chips" role="group" aria-label={t("where")}>
        {([ ["all", "wholeBible"], ["ot", "oldTestament"], ["nt", "newTestament"] ] as const).map(([scope, label]) =>
          <button type="button" key={scope} aria-pressed={value.scope === scope} onClick={() => update({ scope })}>{t(label)}</button>,
        )}
      </div>
      <div className="search-filter-status">
        {activeCount ? <span>{t("searchActiveFilters", { count: activeCount })}</span> : null}
        <button type="button" disabled={!activeCount} onClick={onReset}>{t("searchResetFilters")}</button>
      </div>
    </div>

    <div className="search-filter-grid">
      <label><span>{t("book")}</span><select value={selectedBook} onChange={(event) => update({ scope: event.target.value ? `book:${Number(event.target.value)}` : "all" })}>
        <option value="">{t("searchAllBooks")}</option>
        {books.map((book) => <option key={book.nr} value={book.nr}>{book.name}</option>)}
      </select></label>
      <label><span>{t("searchOrder")}</span><select value={value.sort} onChange={(event) => update({ sort: event.target.value as SearchSort })}>
        <option value="canonical">{t("searchBibleOrder")}</option>
        <option value="canonical_desc">{t("searchReverseOrder")}</option>
        <option value="relevance">{t("searchRelevance")}</option>
      </select></label>
      <label><span>{t("words")}</span><select value={value.words} onChange={(event) => update({ words: event.target.value as WordMode })}>
        <option value="all">{t("allWords")}</option><option value="any">{t("anyWord")}</option><option value="phrase">{t("exactPhrase")}</option>
      </select></label>
      <label><span>{t("match")}</span><select value={value.match} onChange={(event) => update({ match: event.target.value as MatchMode })}>
        <option value="exact">{t("exactWord")}</option><option value="partial">{t("partialWord")}</option>
      </select></label>
    </div>

    <details className="search-filter-advanced">
      <summary><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14M7 3v4m6 1v4m-6 1v4" /></svg><span>{t("searchMoreFilters")}</span><span className="search-filter-chevron" aria-hidden="true">⌄</span></summary>
      <div className="search-filter-grid">
        <label><span>{t("case")}</span><select value={value.caseSensitive ? "exact" : "fold"} onChange={(event) => update({ caseSensitive: event.target.value === "exact" })}>
          <option value="fold">{t("searchCaseInsensitive")}</option><option value="exact">{t("searchCaseSensitive")}</option>
        </select></label>
        <label><span>{t("searchAccents")}</span><select value={value.diacritics} onChange={(event) => update({ diacritics: event.target.value as "fold" | "exact" })}>
          <option value="fold">{t("searchIgnoreAccents")}</option><option value="exact">{t("searchMatchAccents")}</option>
        </select></label>
        <label><span>{t("searchExclude")}</span><input value={value.exclude} placeholder={t("searchExcludePlaceholder")} onChange={(event) => update({ exclude: event.target.value })} /></label>
        <label><span>{t("searchProximity")}</span><input type="number" min="0" max="100" step="1" disabled={value.words !== "all"} value={value.proximity ?? ""} aria-describedby={proximityHelp} placeholder={t("searchAnyDistance")} onChange={(event) => update({ proximity: event.target.value === "" ? undefined : Math.max(0, Math.min(100, Math.floor(Number(event.target.value) || 0))) })} /></label>
      </div>
      <p id={proximityHelp}>{t("searchProximityHelp")}</p>
    </details>
  </div>;
}
