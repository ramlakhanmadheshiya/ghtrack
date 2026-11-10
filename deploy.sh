#!/bin/bash
# ── ghtrack deploy script ──────────────────────────────────────────────
# Publishes ghtrack to https://theramlakhan.com/ghtrack/
# Copies production files into public/ghtrack/ in ramlakhanmadheshiya.github.io
# Without touching any existing code in the parent site.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SITE_REPO="ramlakhanmadheshiya/ramlakhanmadheshiya.github.io"
DEST="public/ghtrack"
WORK="${TMPDIR:-/tmp}/ghtrack-deploy"

echo "=== Deploying ghtrack to theramlakhan.com/ghtrack/ ==="

rm -rf "$WORK"
echo "Cloning site repository..."
gh repo clone "$SITE_REPO" "$WORK" -- --depth 1 --quiet

echo "Syncing ghtrack assets..."
rm -rf "$WORK/$DEST"
mkdir -p "$WORK/$DEST"

cp -R "$ROOT/index.html" "$ROOT/app.js" "$ROOT/app.css" "$ROOT/favicon.svg" "$ROOT/assets" "$WORK/$DEST/"

# Remove OS artifacts
find "$WORK/$DEST" -name .DS_Store -delete

cd "$WORK"
git add "$DEST"

if git diff --cached --quiet; then
  echo "Nothing changed — ghtrack is already up to date on theramlakhan.com."
  exit 0
fi

COMMIT_MSG="ghtrack: deploy $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)"
git commit -q -m "$COMMIT_MSG"
echo "Pushing to GitHub Pages..."
git push -q origin HEAD

echo "✓ Successfully deployed → https://theramlakhan.com/ghtrack/"
