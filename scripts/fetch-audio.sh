#!/usr/bin/env bash
# Downloads the word list source and real-speaker recordings, then builds
# public/data/words.json and public/audio/ (both derived; audio is gitignored).
#
# Source: Baggio Wong's Jyutping Chart, https://github.com/BaggioWongHK/jyutping-chart
# The recordings are not redistributed in this repo; they are fetched from there.
#
#   npm run setup:audio            # or: bash scripts/fetch-audio.sh
set -euo pipefail

REPO_URL="https://github.com/BaggioWongHK/jyutping-chart.git"
COMMIT="04e7a645aa08a9221d527b3b237b4d5ee643276e" # pinned for reproducible builds
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/jyutping-chart"

if [ -d "$DEST/.git" ]; then
  echo "Using existing $DEST"
else
  echo "Fetching recordings and word list from $REPO_URL (sparse, ~170 MB)..."
  git clone --filter=blob:none --no-checkout "$REPO_URL" "$DEST"
  git -C "$DEST" sparse-checkout set audio/chinese javascript
  git -C "$DEST" checkout --quiet "$COMMIT"
fi

cd "$ROOT"
node scripts/build-words.mjs "$DEST"
