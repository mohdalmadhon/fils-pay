#!/usr/bin/env bash
# Deploy FilsPay to the hosted box from your own machine (Git Bash on
# Windows, or any shell with git and ssh), using your SSH key.
#
#   ops/deploy.sh                          # dilmune@159.89.173.8, HTTPS on sslip.io
#   SEED=1 ops/deploy.sh                   # first time: also load the demo data
#   HTTP_ONLY=1 ops/deploy.sh              # no certificate (ports 80/443 closed, say)
#   ops/deploy.sh user@host                # another server
#
# It sends the code of the commit you have checked out (git archive: only
# committed files, nothing pushed to GitHub needed), keeps the previous copy
# as ~/fils-pay.old, then runs ops/remote-deploy.sh on the server, which
# builds and starts everything. docs/deploy.md.
set -euo pipefail

SERVER="${1:-dilmune@159.89.173.8}"
HOST="${SERVER#*@}"
cd "$(git rev-parse --show-toplevel)"
COMMIT="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "deploy: you have uncommitted changes; they are NOT deployed (only commit $COMMIT is)."
fi
echo "deploy: sending $BRANCH @ $COMMIT to $SERVER"

git archive --format=tar HEAD | ssh "$SERVER" "
  set -e
  rm -rf ~/fils-pay.new && mkdir -p ~/fils-pay.new
  tar -x -C ~/fils-pay.new
  echo '$BRANCH @ $COMMIT' > ~/fils-pay.new/DEPLOYED_COMMIT
  if [ -d ~/fils-pay ]; then rm -rf ~/fils-pay.old && mv ~/fils-pay ~/fils-pay.old; fi
  mv ~/fils-pay.new ~/fils-pay
"

# -t: a terminal, so sudo can ask for a password if Docker must be installed.
ssh -t "$SERVER" "PUBLIC_IP='$HOST' SITE_HOST='${SITE_HOST:-}' OPS_HOST='${OPS_HOST:-}' HTTP_ONLY='${HTTP_ONLY:-0}' SEED='${SEED:-0}' bash ~/fils-pay/ops/remote-deploy.sh"
