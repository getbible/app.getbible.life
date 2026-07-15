#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"

command -v npm >/dev/null 2>&1 || { echo "npm is required." >&2; exit 69; }
command -v npx >/dev/null 2>&1 || { echo "npx is required." >&2; exit 69; }

npm test

[[ -f dist/server/index.js ]] || { echo "Missing verified Worker artifact." >&2; exit 66; }
[[ -d dist/client ]] || { echo "Missing static client assets." >&2; exit 66; }

npx wrangler deploy dist/server/index.js \
  --name getbible-reader \
  --compatibility-date 2026-07-15 \
  --assets dist/client
