#!/usr/bin/env bash
# Cloud side: put the commits the laptop doesn't have yet into one file.
#
#   ai-setup/scripts/make-bundle.sh <laptop's current commit> <branch> [out]
#
# The laptop's current commit is what `git rev-parse --short HEAD` prints
# there. The bundle is then copied into the laptop's repo folder.
set -euo pipefail
base="$1"; branch="$2"; out="${3:-ui.bundle}"
git bundle create "$out" "$base..$branch"
git bundle list-heads "$out"
