#!/usr/bin/env bash
# Puts an installer built into dist/ (npm run dist) on the "testing" release of the public
# CrownedPandaXIV/XIVFleetCompanion-Releases repository, which copies of the app with "Get test versions" on look
# at (update-feed.js). The release is a pre-release, so everyone else (who gets the newest normal release) never
# sees it. The new installer goes up first, then latest.yml (what the app reads), then older installers are removed,
# so the app never reads a latest.yml whose installer is missing.
#
# Usage: publish-testing.sh <version> [--if-newer]
#   --if-newer  for a normal release: only replaces what's there when this version is newer, so testers get
#               every normal update but never lose a newer test version.
# Needs the `gh` CLI with GH_TOKEN allowed to write to that repository, and node (for comparing versions).
set -euo pipefail

version="${1:?version required}"
mode="${2:-}"
repo="CrownedPandaXIV/XIVFleetCompanion-Releases"
tag="testing"
installer="XIV-Fleet-Companion-Setup-${version}.exe"
files=("dist/${installer}" "dist/${installer}.blockmap")
for f in "${files[@]}" dist/latest.yml; do test -f "$f" || { echo "Missing ${f}: build with npm run dist first."; exit 1; }; done

exists=false
gh release view "$tag" -R "$repo" >/dev/null 2>&1 && exists=true

if [ "$mode" = "--if-newer" ] && [ "$exists" = true ]; then
  current="$(gh release download "$tag" -R "$repo" -p latest.yml -O - 2>/dev/null | sed -n 's/^version: *//p' | tr -d "'\"\r" || true)"
  if [ -n "$current" ] && ! node "$(dirname "$0")/newer.js" "$version" "$current"; then
    echo "The testing release has ${current}, which is not older than ${version}: left alone."
    exit 0
  fi
fi

# Release notes: the changelog section of the version this is a test of ("1.6.0" for "1.6.0-test.4").
base="${version%%-*}"
notes="$(awk -v v="$base" '
  /^## / { if (found) exit; if ($2 == v) found = 1; next }
  found { print }
' CHANGELOG.md | sed '/./,$!d')"
case "$version" in
  *-test.*) intro="Test version ${version}. Only copies of the app with Settings → General → Updates → Get test versions on get this." ;;
  *) intro="Version ${version}, the newest normal version (no test version is newer). Copies with Get test versions on get it from here." ;;
esac
body="${intro}"$'\n\n'"${notes}"

if [ "$exists" = false ]; then
  gh release create "$tag" -R "$repo" --prerelease --latest=false --title "Test version ${version}" --notes "$body"
fi
gh release upload "$tag" "${files[@]}" -R "$repo" --clobber
gh release upload "$tag" dist/latest.yml -R "$repo" --clobber
gh release edit "$tag" -R "$repo" --prerelease --latest=false --title "Test version ${version}" --notes "$body"
for old in $(gh release view "$tag" -R "$repo" --json assets --jq '.assets[].name'); do
  case "$old" in
    XIV-Fleet-Companion-Setup-*) [ "$old" = "$installer" ] || [ "$old" = "${installer}.blockmap" ] || gh release delete-asset "$tag" "$old" -R "$repo" -y ;;
  esac
done
echo "The testing release now has ${version}."
