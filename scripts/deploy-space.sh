#!/usr/bin/env bash
# Publish the browser demo to the Hugging Face Space (static SDK, no build step).
# Uploads only what index.html needs; the Space's README (with its YAML header) lives in space/README.md.
set -euo pipefail
SPACE="${SPACE:-danielrosehill/LLM-Spoken-Steganography}"
export HF_TOKEN="${HF_TOKEN:-${HUGGINGFACE_TOKEN:?set HF_TOKEN}}"
HF="${HF:-$(command -v hf || echo ~/.local/bin/hf)}"
cd "$(dirname "$0")/.."
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/episode"
cp -r index.html web src LICENSE "$stage/"
cp space/README.md "$stage/README.md"
cp episode/overheard-at-the-laundrette.transcript.md "$stage/episode/"
"$HF" repos create "$SPACE" --repo-type space --space-sdk static --exist-ok
"$HF" upload "$SPACE" "$stage" . --repo-type space --commit-message "Deploy from $(git rev-parse --short HEAD)"
echo "https://huggingface.co/spaces/$SPACE"
