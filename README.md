# getBible.Life

A production-ready, browser-native Bible reader built with React 19, Next.js/Vinext, TypeScript, and the public [GetBible API v2](https://api.getbible.net/v2/translations.json).

## Features

- Every translation, language, book, chapter, and verse is discovered from the API; no Bible structure is hard-coded.
- Shareable URLs and browser back/forward navigation.
- Previous/next paging across book boundaries, `Alt` + arrow keyboard navigation, and mobile swipe navigation.
- Minimal full-page reading with a compact header and collapsible passage navigation.
- Pure black-and-white light and dark themes, adjustable scripture size, responsive layouts, RTL support, and accessible controls.
- Persistent markings: click a verse number to mark a whole verse, or select a word or phrase to mark only that text.
- Custom marking colors and category names, plus a searchable reading history in the Markings drawer.
- Browser Cache Storage for fast repeat visits and offline fallback.
- Every opened chapter is checked against its `.sha` endpoint. Changed chapters are replaced immediately.
- Translation, book, and chapter indexes refresh weekly. Changed upstream hashes invalidate only the affected cache branch.
- The current translation license is displayed with the text.

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

The application stores JSON responses in the browser Cache Storage API. Timestamps, SHA metadata, marking colors, and saved markings are stored in `localStorage`, so annotations remain private to the current browser and device. If the API is temporarily unavailable, a previously cached chapter remains readable and is marked as saved rather than verified. The reader includes a **Clear local cache** action.

## License

Application code is released under the MIT License. Bible translations retain their own upstream licenses, which the reader displays from each translation's API metadata.
