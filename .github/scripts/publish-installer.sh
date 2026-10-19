#!/usr/bin/env bash
# Publishes the Windows installer built into dist/ (npm run dist) to the public
# CrownedPandaXIV/XIVFleetCompanion-Releases repository, where installed copies of the app look for
# updates: the installer, its .blockmap and latest.yml (what electron-updater reads). Release notes come
# from the matching section of CHANGELOG.md. A release that already exists (one an earlier run left
# half-uploaded) gets the files again, replacing any already there.
#
# Usage: publish-installer.sh <version>      (needs the `gh` CLI and GH_TOKEN allowed to write to that repository)
set -euo pipefail

version="${1:?version required}"
tag="v${version}"
repo="CrownedPandaXIV/XIVFleetCompanion-Releases"
files=("dist/XIV-Fleet-Companion-Setup-${version}.exe" "dist/XIV-Fleet-Companion-Setup-${version}.exe.blockmap" "dist/latest.yml")
for f in "${files[@]}"; do test -f "$f" || { echo "Missing ${f}: build with npm run dist first."; exit 1; }; done

notes="$(awk -v v="$version" '
  /^## / { if (found) exit; if ($2 == v) found = 1; next }
  found { print }
' CHANGELOG.md | sed '/./,$!d')"
[ -n "$notes" ] || notes="Version ${version}"

if gh release view "$tag" -R "$repo" >/dev/null 2>&1; then
  gh release upload "$tag" "${files[@]}" -R "$repo" --clobber
  gh release edit "$tag" -R "$repo" --notes "$notes" --draft=false
  echo "Uploaded the installer to the existing ${tag}."
else
  gh release create "$tag" "${files[@]}" -R "$repo" --title "$tag" --notes "$notes"
  echo "Published ${tag}."
fi
