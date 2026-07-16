# Contributing to getBible.Life

Thank you for helping maintain getBible.Life. Keep changes focused, readable, and covered by tests whenever behavior changes.

## Requirements

- Node.js 22 or newer
- npm, using the committed `package-lock.json`

## Local validation

Install the locked dependencies and run the same checks used by GitHub Actions:

```bash
npm ci
npm run ci
```

The CI pipeline reports linting, application type-checking, unit tests, the production build, and rendered-route tests as separate steps. The Vinext production build validates the Cloudflare worker and database deployment adapters, whose platform types are injected by the build environment.

## Change guidelines

1. Create a focused branch and keep commits small and descriptive.
2. Add or update unit tests for changed behavior.
3. Do not commit generated output such as `node_modules`, `dist`, `.next`, or `.wrangler`.
4. Preserve browser storage compatibility unless a migration is deliberately included.
5. Keep GetBible API hash verification and translation licensing behavior intact.
6. Run `npm run ci` before requesting review.

## Pull requests

Describe what changed, why it changed, how it was tested, and any effect on browser storage, API caching, accessibility, or deployment.
