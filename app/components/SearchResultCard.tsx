import type { createUiTranslator } from "../../lib/i18n";
import { highlightSearchText, type MatchMode } from "../../lib/search";
import type { ServerSearchVerse } from "../../lib/scripture-api";

export interface SearchResultCardProps {
  result: ServerSearchVerse;
  query: string;
  match: MatchMode;
  caseSensitive: boolean;
  diacritics?: "fold" | "exact";
  locale?: string;
  showScore: boolean;
  t: ReturnType<typeof createUiTranslator>;
  onOpen: () => void;
}

export function SearchResultCard({ result, query, match, caseSensitive, diacritics, locale, showScore, t, onOpen }: SearchResultCardProps) {
  return <button className="search-result-card" type="button" onClick={onOpen}>
    <span className="search-result-heading"><strong>{result.reference}</strong><span aria-hidden="true">↗</span></span>
    <span className="search-result-text">{highlightSearchText(result.text, query, { match, caseSensitive, diacritics, locale }).map((segment, index) =>
      segment.highlighted ? <mark key={index}>{segment.text}</mark> : segment.text,
    )}</span>
    {result.occurrences !== undefined || result.terms?.length || (showScore && result.score !== undefined) ? <span className="search-result-details">
      {result.occurrences !== undefined ? <span>{t("searchOccurrences", { count: result.occurrences.toLocaleString(locale) })}</span> : null}
      {result.terms?.length ? <span>{t("searchMatchedTerms", { terms: result.terms.join(" · ") })}</span> : null}
      {showScore && result.score !== undefined ? <span>{t("searchMatchScore", { score: result.score.toLocaleString(locale, { maximumFractionDigits: 2 }) })}</span> : null}
    </span> : null}
  </button>;
}
