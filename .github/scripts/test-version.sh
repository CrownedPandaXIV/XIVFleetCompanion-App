#!/usr/bin/env bash
# Prints the version to build a test version of the app as: <version>-test.1 for the first test version of a version,
# then one above the test version of it the testing release has (1.6.0-test.5 after 1.6.0-test.4). A new version starts
# at -test.1 again: 1.6.1-test.1 is newer than 1.6.0-test.9 and than 1.6.0.
#
# Usage: test-version.sh <version> [<version the testing release has>]      (no packages needed)
set -euo pipefail
base="${1:?version required}"
current="${2:-}"
last=0
case "$current" in
  "$base"-test.*) n="${current#"$base"-test.}"; [[ "$n" =~ ^[0-9]+$ ]] && last="$n" ;;
esac
echo "${base}-test.$(( last + 1 ))"
