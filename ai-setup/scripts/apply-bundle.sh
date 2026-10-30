#!/usr/bin/env bash
# Laptop side (Git Bash), in the repo folder: fast-forward the current
# branch to the bundle's commits, then delete the bundle. Refuses anything
# that isn't a fast-forward, so local work is never overwritten.
#
#   ai-setup/scripts/apply-bundle.sh <bundle> <branch inside the bundle>
set -euo pipefail
bundle="$1"; branch="$2"
git bundle list-heads "$bundle"
git fetch -q "./$bundle" "$branch:refs/fp-import/incoming"
git -c core.autocrlf=true merge --ff-only refs/fp-import/incoming
git update-ref -d refs/fp-import/incoming
rm -f "$bundle"
git log --oneline -5
git -c core.autocrlf=true status --short
