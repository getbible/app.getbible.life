# getBible.Life

A production-ready, browser-native Bible reader built with React 19, Next.js/Vinext, TypeScript, and the public [GetBible API v2](https://api.getbible.net/v2/translations.json).

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
- First-time readers open the daily Scripture in King James Version; clicking `getBible.Life` returns to that day’s cached verse in KJV.
- Full-screen-width reading by default, optional page width, nine selectable reading fonts, edge-to-edge mobile reading, and touch-sized controls.
- A glasses button opens the current chapter as Markdown with an H1 chapter heading, valid ordered-list verses, Copy and Download `.md` actions, and the translation’s full name plus copyright/license notice in the footer.
- A muted desktop-only end-of-chapter footer links the current passage to `getbible.life` and displays the dynamically current Vast Development Method copyright year.
- The browser favicon is the replaceable 96×96 `public/favicon.png` asset.
- Translation-wide local search with all-word, any-word, phrase, partial/exact word, case, testament, and book filters. The whole translation is downloaded once, cached against its upstream hash, and searched with Unicode-aware segmentation.
- Search results lock the underlying reader scroll and highlight every matching word using the active appearance palette.
- Opening a search result centers its verse and temporarily emphasizes the verse and matched words for seven seconds.
- Search is non-blocking and incremental: each edit restarts an ordered scan, the first 20 matches appear immediately, and further groups load as the result list is scrolled.
- Appearance can follow the operating system automatically or be switched manually; the selected light and dark palettes are preserved independently.
- Browser Cache Storage for fast repeat visits and offline fallback.
- Every opened chapter is checked against its `.sha` endpoint. Changed chapters are replaced immediately.
- Translation, book, and chapter indexes refresh weekly. Changed upstream hashes invalidate only the affected cache branch.
- The current translation license is displayed with the text.
- Clickable translation credits with complete API metadata, licensing, source details, and version history.
- Persistent reader layout switch between one verse per line and a continuous paragraph.
- Sixty searchable starter marking groups with a compact large-list color picker and editable deployment colors.
- Language-aware translation sorting with a CLDR-backed fallback when an API language name is absent.
- Maintenance and CrossWire synchronization information available from the site footer.

## API architecture

| Resource | Endpoint |
| --- | --- |
| Translations | `/v2/translations.json` |
| Translation books | `/v2/{translation}/books.json` |
| Book chapters | `/v2/{translation}/{book}/chapters.json` |
| Chapter | `/v2/{translation}/{book}/{chapter}.json` |
| Chapter hash | `/v2/{translation}/{book}/{chapter}.sha` |

The API's index resources contain child hashes. GetBible does not currently expose `.sha` files for `translations.json`, `books.json`, or `chapters.json`, so those indexes are refreshed weekly and their embedded hashes are compared. Individual chapters do expose `.sha` files and are verified whenever opened.

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

The application stores JSON responses in the browser Cache Storage API. Timestamps, SHA metadata, marking colors, saved markings, verse notes, daily Scripture, whole-translation search data, and the last visible verse are stored in durable browser storage, so annotations remain private to the current browser and device. The app requests persistent-storage protection when the browser supports it. If the API is temporarily unavailable, a previously cached chapter remains readable and is marked as saved rather than verified. **Clear all local data** requires confirmation and removes every locally stored reader item, including search indexes.

## Deployment marking groups

Edit `config/reader.ts` to choose the initial marking names and colors for a deployment. Browser-customized color lists are preserved across deployments; the configured list is used for new installations or after local site data is cleared. The Markings drawer provides bounded scrolling and search when the configured list grows.

## License

Application code is released under the [GNU General Public License v3.0](LICENSE) and is maintained by Llewellyn van der Merwe of Vast Development Method. Bible translations retain their own upstream licenses, which the reader displays from each translation's API metadata.

## Contributing and continuous integration

GitHub Actions validates every push and pull request with locked dependency installation, linting, TypeScript checking, unit tests, a production build, and rendered-route tests. See [CONTRIBUTING.md](CONTRIBUTING.md) for the local workflow and maintenance guidelines.
