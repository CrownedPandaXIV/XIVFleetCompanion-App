#!/usr/bin/env bash
# Says whether a version of the app is fully published in CrownedPandaXIV/XIVFleetCompanion-Releases: its release is
# there, not a draft, and has all three files (the installer, its .blockmap and latest.yml). Prints "yes" or "no".
# A run cut off part way (say, the network dropping while the installer went up) leaves a draft, or a release missing a
# file: that counts as not published, so the next run finishes it (publish-installer.sh uploads again and publishes).
#
# Usage: published.sh <version>      (needs the `gh` CLI and GH_TOKEN allowed to read that repository)
set -euo pipefail

version="${1:?version required}"
repo="CrownedPandaXIV/XIVFleetCompanion-Releases"
info="$(gh release view "v${version}" -R "$repo" --json isDraft,assets 2>/dev/null || true)"
if [ -z "$info" ]; then echo no; exit 0; fi
if [ "$(jq -r '.isDraft' <<<"$info")" = "true" ]; then echo no; exit 0; fi
for f in "XIV-Fleet-Companion-Setup-${version}.exe" "XIV-Fleet-Companion-Setup-${version}.exe.blockmap" latest.yml; do
  jq -e --arg f "$f" '[.assets[].name] | index($f) != null' <<<"$info" > /dev/null || { echo no; exit 0; }
done
echo yes
