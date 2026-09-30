#!/usr/bin/env bash
# Regenerates demo.gif from the live site (readme-writer skill scripts; run its setup.sh first).
# Usage: SKILL=~/.agents/skills/readme-writer bash .github/assets/capture.sh
set -euo pipefail
out=$(mktemp -d)
node "$SKILL/scripts/capture-web.cjs" https://kessler.kudayyurter.dev "$out" --seconds 10 --wait 6000
bash "$SKILL/scripts/to-gif.sh" "$out/demo.webm" .github/assets/demo --start 6 --length 5 --width 880 --fps 12
rm -f .github/assets/demo.mp4   # keep only the GIF; the MP4 is for a github.com upload if wanted
