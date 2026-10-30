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
# remote-deploy.sh builds the sslip.io names from PUBLIC_IP, so pass it only
# when HOST is a literal IPv4 address. For a DNS name or an ssh alias it is
# left empty and remote-deploy.sh asks the network for the public IP.
if [[ "$HOST" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then PUBLIC_IP="$HOST"; else PUBLIC_IP=""; fi
cd "$(git rev-parse --show-toplevel)"
COMMIT="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "deploy: you have uncommitted changes; they are NOT deployed (only commit $COMMIT is)."
fi
echo "deploy: sending $BRANCH @ $COMMIT to $SERVER"

# core.autocrlf=false: send the files as committed (LF), even from Git for
# Windows, whose default (true) would turn the shell scripts into CRLF files
# that bash on the server cannot run. .gitattributes does the same.
git -c core.autocrlf=false archive --format=tar HEAD | ssh "$SERVER" "
  set -e
  rm -rf ~/fils-pay.new && mkdir -p ~/fils-pay.new
  tar -x -C ~/fils-pay.new
  echo '$BRANCH @ $COMMIT' > ~/fils-pay.new/DEPLOYED_COMMIT
  if [ -d ~/fils-pay ]; then rm -rf ~/fils-pay.old && mv ~/fils-pay ~/fils-pay.old; fi
  mv ~/fils-pay.new ~/fils-pay
"

# -t: a terminal, so sudo can ask for a password if Docker must be installed.
ssh -t "$SERVER" "PUBLIC_IP='$PUBLIC_IP' SITE_HOST='${SITE_HOST:-}' OPS_HOST='${OPS_HOST:-}' HTTP_ONLY='${HTTP_ONLY:-0}' SEED='${SEED:-0}' bash ~/fils-pay/ops/remote-deploy.sh"
