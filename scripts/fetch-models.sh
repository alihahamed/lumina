#!/usr/bin/env bash
# Downloads model files that ship inside the app but are too big for git.
# Run once after cloning, and before building an APK: `npm run fetch-models`.
#
# The depth model is bundled rather than downloaded by the phone at first launch:
# depth is the safety layer, and on our network GitHub's asset CDN resolved to an
# unreachable address from the phone. docs/decisions.md 2026-09-27.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p assets/models

fetch() {
  local url=$1 out=$2 sha=$3
  if [ -f "$out" ] && echo "$sha  $out" | sha256sum -c --status; then
    echo "ok       $out"
    return
  fi
  echo "fetching $out"
  # --retry because one of GitHub's four CDN addresses was unreachable from our network.
  curl -fL --progress-bar --retry 5 --retry-all-errors --connect-timeout 10 -o "$out.part" "$url"
  echo "$sha  $out.part" | sha256sum -c --status || { echo "checksum mismatch for $out" >&2; rm -f "$out.part"; exit 1; }
  mv "$out.part" "$out"
  echo "ok       $out"
}

fetch \
  https://github.com/alihahamed/lumina/releases/download/models-v1/depth_anything_v2_metric_indoor_small_140.pte \
  assets/models/depth_anything_v2_metric_indoor_small_140.pte \
  059022a3ae1930310848dbdfabb88be6eacabdd8a7480e47db2767989660acc0

fetch \
  https://github.com/alihahamed/lumina/releases/download/models-v1/segformer_b0_ade20k_512.pte \
  assets/models/segformer_b0_ade20k_512.pte \
  ec11dbb4262d7b1254efc206117ff035047ff83c0a8e110a5c5e30c0b8ef5d9e
