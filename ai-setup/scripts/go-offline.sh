#!/usr/bin/env bash
# Build or test apps/settlement when the Go module mirror (proxy.golang.org)
# can't be reached but GitHub can. The three golang.org/x modules pgx needs
# are cloned from their GitHub mirrors at the versions go.sum expects, and a
# temporary module file points at them. The repo's go.mod and go.sum are
# not touched.
#
#   ai-setup/scripts/go-offline.sh test ./...
#   ai-setup/scripts/go-offline.sh build ./...
set -euo pipefail
cache="${GO_OFFLINE_DIR:-/tmp/go-offline}"
repo="$(git rev-parse --show-toplevel)"
mkdir -p "$cache"
for spec in "text v0.21.0" "crypto v0.31.0" "sync v0.10.0"; do
  read -r mod version <<< "$spec"
  [ -d "$cache/$mod" ] || git -c advice.detachedHead=false clone -q --depth 1 --branch "$version" "https://github.com/golang/$mod" "$cache/$mod"
done
cp "$repo/apps/settlement/go.mod" "$cache/go.tmp.mod"
cp "$repo/apps/settlement/go.sum" "$cache/go.tmp.sum"
for m in text crypto sync; do
  printf 'replace golang.org/x/%s => %s/%s\n' "$m" "$cache" "$m" >> "$cache/go.tmp.mod"
done
cd "$repo/apps/settlement"
GOFLAGS="-modfile=$cache/go.tmp.mod" GOPROXY=off go "$@"
