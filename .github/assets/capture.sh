#!/usr/bin/env bash
# .github/assets/capture.sh: regenerates demo.gif from the live site: search "ISS",
# pick ISS (ZARYA), and the globe flies to it (steps in steps.json).
# Uses the readme-writer skill scripts; run its setup.sh first.
# Usage (from the repo root): SKILL=~/.agents/skills/readme-writer bash .github/assets/capture.sh
set -euo pipefail
out=$(mktemp -d)
# --size auto picked 1920x1080 (the right-hand panel column scrolls by design).
node "$SKILL/scripts/capture-web.cjs" https://kessler.kudayyurter.dev "$out" --steps .github/assets/steps.json --wait 6000
# capture-web prints the exact --start/--length for the recorded steps:
bash "$SKILL/scripts/to-gif.sh" "$out/demo.webm" .github/assets/demo --start 6.3 --length 12.8
rm -f .github/assets/demo.mp4   # keep only the GIF; the MP4 is for a github.com upload if wanted
