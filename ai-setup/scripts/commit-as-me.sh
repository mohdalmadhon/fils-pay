#!/usr/bin/env bash
# Commit the named files as Mohammed: author AND committer, no trailer lines.
# Run from the repo root.
#
#   ai-setup/scripts/commit-as-me.sh "subject" "body (optional)" file1 file2 ...
#
# git add -A -- <files> stages additions, changes and deletions of exactly
# those paths, nothing else. Override the identity with AUTHOR_NAME and
# AUTHOR_EMAIL.
set -euo pipefail
subject="$1"; body="$2"; shift 2
name="${AUTHOR_NAME:-malmadhoo}"
email="${AUTHOR_EMAIL:-mohammedalmadhoon000@gmail.com}"
git add -A -- "$@"
GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email" \
  git -c user.name="$name" -c user.email="$email" commit -q -m "$subject" ${body:+-m "$body"}
git log -1 --format='%h %an / %cn  %s'
# The message must carry no co-author or session lines.
if git log -1 --format=%B | grep -qiE '^(co-authored-by|claude-session|reviewed-per):'; then
  echo "commit-as-me: trailer line found in the message; amend it" >&2
  exit 1
fi
