# getBible.Life

A production-ready, browser-native Bible reader built with React 19, Next.js/Vinext, TypeScript, and the public [GetBible API v3](https://getbible.net/api/bible/v3.md) and its study APIs.

## Features

- Every translation, language, book, chapter, and verse is discovered from the API; no Bible structure is hard-coded.
- Shareable URLs and browser back/forward navigation.
- Canonical passage paths such as `/KJV/Ephesians/5`, including direct-link reloads and automatic conversion of restored/query-based passages to friendly URLs.
- Previous/next paging across book boundaries, `Alt` + arrow keyboard navigation, and mobile swipe navigation.
- Deliberate continuous reading: a second mouse-wheel or vertical touch-drag gesture at a boundary opens the adjacent chapter, preventing accidental paging.
- Minimal full-page reading with a compact header and collapsible passage navigation.
- Selectable light and dark reading palettes, including pure black, warm brown, charcoal, and midnight themes, plus adjustable scripture size, RTL support, and accessible controls.
- Persistent markings: click a verse number to mark a whole verse, or select a word or phrase to mark only that text.
- Custom marking colors and category names, with marking groups listed first and the selected group's color retained as the next marking default.
- Portable JSON backup and merge-import for markings, with duplicate prevention and safe bulk deletion.
- Long-term verse notes with Bible-order navigation; backups include notes, markings, and custom color groups.
- Verse notes and whole-verse markings follow the canonical book/chapter/verse across translations; selected word and phrase markings remain translation-specific.
- The visible reading position is remembered down to the verse and restored on the next visit.
- First-time readers open the daily Scripture in King James Version; clicking `getBible.Life` returns to that day’s cached verse in KJV. Source book aliases are resolved through Query v3 when they differ from the Bible catalogue’s canonical names.
- Full-screen-width reading by default, optional page width, nine selectable reading fonts, edge-to-edge mobile reading, and touch-sized controls.
- A glasses button opens the current chapter as Markdown with an H1 chapter heading, valid ordered-list verses, Copy and Download `.md` actions, and the translation’s full name plus copyright/license notice in the footer.
- A muted desktop-only end-of-chapter footer links the current passage to `getbible.life` and displays the dynamically current Vast Development Method copyright year.
- The browser favicon is the replaceable 96×96 `public/favicon.png` asset.
- Translation-wide [Search v3](https://getbible.net/api/search/v3.md) with all-word, any-word, phrase, whole-word/substring, case, testament, book, accent, exclusion, proximity, and relevance filters. Quick testament filters and a grouped advanced panel keep the controls accessible. Results show total/loaded counts, matched terms, occurrence counts, and relevance scores when applicable; ordering supports Bible order, last-to-first, and relevance.
- Search results lock the underlying reader scroll and highlight every matching word using the active appearance palette.
- Opening a search result centers its verse and temporarily emphasizes the verse and matched words for seven seconds.
- Search is debounced and cancellable; each edit starts a new API search. Pages contain 25 results, with scroll loading and an accessible Load more button. Translation hash or search-engine changes require a new search. The API exposes at most 10,100 matches per search; larger searches prompt readers to narrow the testament or book filter.
- Appearance can follow the operating system automatically or be switched manually; the selected light and dark palettes are preserved independently.
- Browser Cache Storage for fast repeat visits and offline fallback.
- Individual chapter downloads verify exact source bytes against their SHA-1. Complete translation downloads verify their own hash and serve chapters and navigation indexes directly for one week before revalidation.
- Bible, dictionary, commentary, catalog, and reference caches carry timestamps and refresh in the background after 30 days when used online. Changed parent hashes expire the affected navigation indexes while retaining previously saved bodies.
- The current translation license is displayed with the text.
- Clickable translation credits with complete API metadata, licensing, source details, and version history.
- Persistent reader layout switch between one verse per line and a continuous paragraph.
- Sixty searchable starter marking groups with a compact large-list color picker and editable deployment colors.
- Language-aware translation sorting with a CLDR-backed fallback when an API language name is absent.
- Maintenance and CrossWire synchronization information available from the site footer.
- The established reader interface follows the selected Bible translation's language. Locale packs cover all 69 language identifiers currently exposed by the GetBible API, switch document direction for RTL languages, and preserve project names, scripture, API book names, and user-created study labels verbatim.

- Source v3 tokens and spans add supplied-word italics, Jesus quotations, lexical details, source notes, and clickable references without changing verse text or saved selection offsets. Source headings and paragraph boundaries are optional.
- Click a word for dictionaries and a search action; double-click, drag, and long-press selection remain available for personal highlights. Selected phrases also have Search, Study, and Reference actions.
- Dictionaries match headwords, aliases, and published entry IDs without case or accent sensitivity, retaining the Strong’s default for supplied lexical tokens. The reader prepares a reusable index in the background; the dropdown contains only dictionaries with confirmed nonempty definitions for the selection. Multiple definitions and related entries stay available.
- Chapter and verse commentaries use published coverage lists, include book/chapter introductions, and link structured citations to a [Query v3](https://getbible.net/api/query/v3.md) modal without changing the reading position.
- Shared bookmark topics can be browsed, localized, previewed, and merged into stable local marking groups without duplicate imports. Personal highlights take visual priority and do not erase topic memberships.
- Reader options contains the Downloads & storage hub: download/refresh the current translation, all or individual dictionaries/commentaries, inspect saved sizes and dates, and remove each resource or clear a cache family. Bookmark-catalog downloads stay with the bookmark topics in Study. A versioned service worker preserves the reader shell, local fonts, and language packs after a successful online installation.

## API architecture

| Resource | Endpoint |
| --- | --- |
| Translation index | `https://api.getbible.net/v3/translations.json` |
| Translation books | `https://api.getbible.net/v3/{translation}/books.json` |
| Book chapters | `https://api.getbible.net/v3/{translation}/{book}/chapters.json` |
| Chapter / hash | `https://api.getbible.net/v3/{translation}/{book}/{chapter}.json` / `.sha` |
| Complete translation / hash | `https://api.getbible.net/v3/{translation}.json` / `.sha` |
| Scripture references | `https://query.getbible.net/v3/{translation}/{encoded-reference}` |
| Paginated search | `https://search.getbible.net/v3/{translation}?q=…&limit=25&offset=…` |
| Dictionary catalog / index / entry | `https://dictionaries.getbible.net/v1/dictionaries.json`, `/{dictionary}/index.json`, `/{dictionary}/{entry-id}.json` |
| Commentary catalog / books / chapter | `https://commentaries.getbible.net/v1/commentaries.json`, `/{commentary}/books.json`, `/{commentary}/{book}/{chapter}.json` |
| Shared bookmark topics / topic / complete catalog | `https://bookmarks.getbible.net/v1/topics.json`, `/topics/{topic}.json`, `/all.json` |

The API clients are separated into `lib/cache.ts` (Bible resources), `lib/scripture-api.ts` (Query and Search), and `lib/study-api.ts` (dictionaries, commentaries, and public bookmarks). Verse rendering uses `lib/annotations.ts`; imported topic identity uses `lib/shared-bookmarks.ts`. Server search follows `matches`, not chapter-object iteration, and finds each returned verse by its emitted verse number. Reference queries encode the complete single/ranged/chained reference once. A published commentary link that labels multiple passages opens every referenced passage in one modal; individual passage chips remain available. Numeric book references such as `43 3:16` remain usable across translation languages; supported OSIS references are normalized before query requests.

Lexical source token text never replaces `verse.text`. Display-word positions are one-based inclusive, source-token indexes are zero-based inclusive, and unlocated source annotations remain outside selectable scripture. Personal character-offset markings therefore keep the same anchors.

Dictionary entries are loaded by published index IDs, including duplicate occurrences. Commentaries use chapter files and `entry.verses ?? [entry.verse]`; chapter zero and verse zero provide introductions. Complete study downloads verify SHA-256 against the published manifest before replacing a saved module. Public bookmarks are read-only API collections; imports merge into the existing local system.

Official contracts: [Bible v3](https://api.getbible.net/v3/openapi.json), [Query v3](https://query.getbible.net/v3/openapi.json), [Search v3](https://search.getbible.net/v3/openapi.json), [Dictionaries v1](https://dictionaries.getbible.net/v1/openapi.json), [Commentaries v1](https://commentaries.getbible.net/v1/openapi.json), [Bookmarks v1](https://bookmarks.getbible.net/v1/openapi.json), and the [documentation index](https://getbible.net/index.md).

## Requirements

- Node.js 22.13 or newer
- npm 10 or newer

## Development

```bash
npm ci
npm run dev
```

Open the address printed by the development server.

## Quality checks

```bash
npm run lint
npm test
```

`npm test` runs the TypeScript unit tests, builds the production Worker, validates the artifact contract, and verifies the rendered HTML.

## Production deployment

```bash
npm run deploy
```

The deployment script runs all tests, requires Wrangler authentication, and deploys the verified Worker and static assets to Cloudflare. For ChatGPT Sites deployments, use the Sites checkpoint workflow instead; the same verified build artifact is used.

## Cache behavior

Bible v3 data has an isolated cache namespace. Existing personal markings, notes, backups, colors, appearance, URLs, and reading positions are retained; legacy bookmark groups can migrate into the unified topic snapshot. Dictionaries, commentaries, public catalogs, query previews, and the versioned shell use separate caches. Large resource bodies stay in Cache Storage, with bounded in-memory copies; localStorage holds small metadata and preferences.

A complete translation is downloaded once and its chapters/indexes are read directly from that file. Downloaded corpora also supply startup translation metadata if the separate catalog or local metadata has been evicted. Saved content opens immediately both online and offline, without waiting for network hash checks. After 30 days, online reads trigger a deduplicated background refresh; failed updates retain the previous saved copy. Fast cached reads cannot leave the deferred loading indicator stuck on screen. Complete dictionary and commentary downloads likewise supply entries and chapter coverage without per-entry downloads. Network requests have timeouts and cancellation; obsolete responses cannot replace a newer lookup. Storage failures keep online reading available and never claim a session-only download is saved offline. Previously cached content remains a fallback when a service is unavailable.

Live search needs a connection. Downloaded resources and previously opened reference previews remain available offline. Cached reference previews also open immediately and refresh after 30 days; uncached query errors retain their original status. Download cancellation keeps completed resources, and cache removal cancels pending refreshes so removed content is not restored by an older request. The reader requests persistent storage where supported. **Clear all local data** confirms deletion and clears personal records, preferences, study downloads, reference caches, old Bible caches, and offline shell caches.

Offline shell manifests are generated from the actual production assets after compilation. A fully cached update activates immediately so an older worker cannot keep serving the previous reader offline. Older compiled assets remain available for 30 days to support already-open tabs; API data caches are independent of shell updates. Fonts use portable asset URLs instead of paths from a developer’s checkout. Offline download confirmation requires the worker to confirm every interface asset is saved; a missing shell is reported separately from saved translation data.

## Bookmark topics

Built-in bookmark topics come from the getBible Bookmarks API. New readers start with the global topics, and can download all global bookmarks or one topic at a time in the same list used for personal bookmarks. Existing readers are offered a migration that merges matching names, aliases and localized topics while preserving custom topics and personal data. Downloaded entries carry a G badge and can be removed without deleting personal bookmarks. Topic names and colors remain editable, and backups preserve global provenance. Browser storage saves topics and bookmarks together as one atomic snapshot.

The translated Verified explanation links to the Bible API documentation, and translation information includes a padded getBible credit with its official icon, “The Word for the world!” slogan, and an API attribution. Commentary, dictionary, and annotation controls appear below Scripture. Jesus speaker metadata supplies red text without a redundant speaker annotation; other source metadata remains visible.

## Interface localization

English source messages live in `lib/i18n.ts`; generated, lazily loaded language packs live in `public/locales/`. The active interface locale is derived from the selected translation's API `lang` value—there is no separate locale preference to become out of sync with the Bible selection. Missing individual messages fall back to English, and historical or low-resource language identifiers without reliable machine-translation support use the complete English pack. Keeping packs as static per-language files avoids adding every language to the initial JavaScript bundle.

To refresh locale coverage after adding or changing an English UI message:

```bash
npm run i18n:generate
npm run typecheck
npm run test:unit
```

The generator reads the live GetBible translation inventory, protects interpolation tokens and project names, and writes deterministic JSON locale data. Generated wording should be reviewed by native speakers before release. Never put scripture, API-provided book names, translation metadata content, or user-created marking names through the UI translator.

## License

Application code is released under the [GNU General Public License v3.0](LICENSE) and is maintained by Llewellyn van der Merwe of Vast Development Method. Bible translations retain their own upstream licenses, which the reader displays from each translation's API metadata.

## Contributing and continuous integration

GitHub Actions validates every push and pull request with locked dependency installation, linting, TypeScript checking, unit tests, a production build, and rendered-route tests. See [CONTRIBUTING.md](CONTRIBUTING.md) for the local workflow and maintenance guidelines.
